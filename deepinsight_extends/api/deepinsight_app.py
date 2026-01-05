from copy import deepcopy
import json
import time
import traceback
import logging
from quart import Response, request
from werkzeug.datastructures import FileStorage
from io import BytesIO
from urllib.parse import quote
from api.apps import login_required, current_user
from api.db.db_models import Conversation, Dialog
from api.db.services.file_service import FileService
from api.utils.file_utils import filename_type
from common.constants import LLMType
from api.db.services.conversation_service import ConversationService, structure_answer
from api.db.services.dialog_service import DialogService
from api.db.services.llm_service import LLMBundle, TenantLLMService
from api.utils.api_utils import get_data_error_result, server_error_response, validate_request, get_json_result
from common.misc_utils import get_uuid
from common.settings import STORAGE_IMPL
from deepinsight_extends.api.clients.conference_client import get_pptx_from_deepinsight
from deepinsight_extends.api.clients.pdf_client import get_pdf_from_deepinsight, get_deep_research_pdf_from_deepinsight
from deepinsight_extends.api.schemas.deepresearch import ArgOptionsGeneric, ChatArgs, ConferencePPTGenRequest, LLMConfig, LLMSetting, PdfGenerateRequest
from deepinsight_extends.api.transformers.deepreserach_transformer import chat

CONVERSATION_FILES_FOLDER_NAME = ".conversation_files"

MODEL_INVOKE_ERROR_MESSAGE = f"data: code: 500, message: external model failed"


async def _chat_main(chat=None, scene="deep_research"):
    req = await request.json
    msg = []
    for m in req["messages"]:
        if m["role"] == "system":
            continue
        if m["role"] == "assistant" and not msg:
            continue
        msg.append(m)
    message_id = msg[-1].get("id")
    try:
        conversation_id = req["conversation_id"]
        e, conv = ConversationService.get_by_id(conversation_id)
        if not e:
            return get_data_error_result(message="Conversation not found!")
        conv.message = deepcopy(req["messages"])
        e, dia = DialogService.get_by_id(conv.dialog_id)
        if not e:
            return get_data_error_result(message="Dialog not found!")
        del req["conversation_id"]
        del req["messages"]

        if not conv.reference:
            conv.reference = []
        else:
            def get_value(d, k1, k2):
                return d.get(k1, d.get(k2))

            for ref in conv.reference:
                if isinstance(ref, list):
                    continue
                ref["chunks"] = [
                    {
                        "id": get_value(ck, "chunk_id", "id"),
                        "content": get_value(ck, "content", "content_with_weight"),
                        "document_id": get_value(ck, "doc_id", "document_id"),
                        "document_name": get_value(ck, "docnm_kwd", "document_name"),
                        "dataset_id": get_value(ck, "kb_id", "dataset_id"),
                        "image_id": get_value(ck, "image_id", "img_id"),
                        "positions": get_value(ck, "positions", "position_int"),
                    }
                    for ck in ref.get("chunks", [])
                ]

        if not conv.reference:
            conv.reference = []
        conv.reference.append({"chunks": [], "doc_aggs": []})
        req["conv"] = conv

        def stream():
            nonlocal dia, msg, req, conv
            try:
                created_at = time.time()
                for ans in chat(dia, msg, True, scene, **req):
                    ans["created_at"] = created_at
                    if "updated_at" not in ans:
                        ans["updated_at"] = time.time()
                    need_update_conversation = False
                    if "need_update_conversation" in ans:
                        need_update_conversation = ans["need_update_conversation"]
                        del ans["need_update_conversation"]
                    ans = structure_answer(conv, ans, message_id, conv.id)
                    if need_update_conversation:
                        ConversationService.update_by_id(conv.id, conv.to_dict())
                    yield "data:" + json.dumps({"code": 0, "message": "", "data": ans}, ensure_ascii=False) + "\n\n"
                content = conv.message[-1].get("content") if isinstance(conv.message[-1].get("content"), str) else \
                    conv.message[-1].get("content")[-1].get("content")
                ConversationService.update_by_id(conv.id, conv.to_dict())
            except ValueError:
                yield MODEL_INVOKE_ERROR_MESSAGE
            except Exception as e:
                logging.error(f"{type(e).__name__}: {e}", exc_info=True)
                yield "data:" + json.dumps(
                    {"code": 500, "message": str(e), "data": {"answer": "**ERROR**: " + str(e), "reference": []}},
                    ensure_ascii=False) + "\n\n"
            yield "data:" + json.dumps({"code": 0, "message": "", "data": True}, ensure_ascii=False) + "\n\n"

        if req.get("stream", True):
            resp = Response(stream(), mimetype="text/event-stream")
            resp.headers.add_header("Cache-control", "no-cache")
            resp.headers.add_header("Connection", "keep-alive")
            resp.headers.add_header("X-Accel-Buffering", "no")
            resp.headers.add_header("Content-Type", "text/event-stream; charset=utf-8")
            return resp

        else:
            answer = None
            for ans in chat(dia, msg, **req):
                if "need_update_conversation" in ans:
                    del ans["need_update_conversation"]
                answer = structure_answer(conv, ans, message_id, req["conversation_id"])
                ConversationService.update_by_id(conv.id, conv.to_dict())
            return get_json_result(data=answer)
    except Exception as e:
        return server_error_response(e)



@manager.route("/chat", methods=["POST"])  # noqa: F821
@login_required
@validate_request("conversation_id", "messages")
async def deep_research():
    return await _chat_main(chat=chat, scene="deep_research")


@manager.route("/deep_research/pdf/generate", methods=["GET"])  # noqa: F821
@login_required
async def generate_deep_research_pdf():
    conv_id = request.args.get("conversation_id")
    if not conv_id:
        return Response(status=400)
    e, conv = ConversationService.get_by_id(conv_id)
    if not e:
        logging.error(f"会话{conv_id!r}不存在")
        return Response(f"会话{conv_id!r}不存在", status=404)
    conv: Conversation
    if conv.user_id != current_user.id:
        logging.error(f"会话{conv_id!r}不存在")
        return Response(f"会话{conv_id!r}不存在", status=404)
    filename = conv.name  # postfix added by DeepInsight
    try:
        last_msg = conv.message[-1].get("content")[-1]
        if last_msg.get("type") != "result":
            return Response(f"会话{conv_id!r}未生成报告，请稍后重试", status=500)
        content = last_msg.get("content")
    except Exception as e:
        logging.error(f"获取深度洞察会话{conv_id!r}的结果时遇到了未知的{type(e).__name__}: e", exc_info=True)
        raise RuntimeError(f"会话{conv_id!r}未生成报告，请稍后重试") from e
    if not content:
        raise RuntimeError(f"会话{conv_id!r}未生成报告，请稍后重试")
    disposition, content_type, binary = get_deep_research_pdf_from_deepinsight(conv_id, filename, content)
    return Response(binary, headers={
        "Content-Disposition": disposition,
        "Content-Type": content_type
    })


@manager.route("/conference_question", methods=["POST"])  # noqa: F821
@login_required
@validate_request("conversation_id", "messages")
async def conference_question():
    req = await request.json
    conversation_id = req["conversation_id"]
    e, conv = ConversationService.get_by_id(conversation_id)
    if not e:
        return get_data_error_result(message="Conversation not found!")
    e, dialog = DialogService.get_by_id(conv.dialog_id)
    if not e:
        return get_data_error_result(message="Dialog not found!")
    return await _chat_main(chat=chat, scene="conference_qa")


@manager.route("/pdf/generate", methods=["POST"])
@login_required
@validate_request("conversation_id")
async def deepinsight_pdf_generate():
    try:
        req = await request.json
        conversation_id = req.get("conversation_id")

        if not conversation_id:
            return get_data_error_result(message="Conversation not found!")

        e, conv = ConversationService.get_by_id(conversation_id)
        if not e:
            return get_data_error_result(message="Conversation not found!")

        e, dialog = DialogService.get_by_id(conv.dialog_id)
        if not e:
            return get_data_error_result(message="Dialog not found!")

        model_config = TenantLLMService.get_model_config(dialog.tenant_id, LLMType.CHAT, dialog.llm_id)
        llm_config = LLMConfig(
            model=model_config["llm_name"],
            base_url=model_config.get("api_base", None) or None,
            api_key=model_config.get("api_key", None) or None,
            setting=LLMSetting(
                temperature=dialog.llm_setting.get("temperature", 0.7),
                top_p=dialog.llm_setting.get("top_p", 1.0),
                frequency_penalty=0,
                presence_penalty=0,
                max_tokens=dialog.llm_setting.get("max_tokens", 8192),
            )
        )
        llm_factory = model_config.get("llm_factory", None) or None
        pdf_request = PdfGenerateRequest(
            conversation_id=conv.id,
            args=ChatArgs(
                llm_options=[
                    ArgOptionsGeneric[LLMConfig](
                        type=llm_factory,
                        params=llm_config,
                    )
                ]
            )
        )
        pdf_bytes, filename = get_pdf_from_deepinsight(pdf_request)
        utf8_file_name = quote(filename, encoding='utf-8')
        content_disposition = f'attachment; filename={utf8_file_name}'
        response = Response(pdf_bytes.getvalue(), mimetype="text/pdf; charset=utf-8")
        response.headers["Content-Disposition"] = content_disposition
        response.headers["Content-Type"] = "application/octet-stream"

        return response

    except Exception as e:
        return server_error_response(e)


@manager.route("/ppt/generate", methods=["POST"])
@login_required
@validate_request("conversation_id")
async def deepinsight_ppt_generate():
    try:
        req = await request.json
        conversation_id = req.get("conversation_id")

        if not conversation_id:
            return get_data_error_result(message="Conversation not found!")

        e, conv = ConversationService.get_by_id(conversation_id)
        if not e:
            return get_data_error_result(message="Conversation not found!")

        e, dialog = DialogService.get_by_id(conv.dialog_id)
        if not e:
            return get_data_error_result(message="Dialog not found!")

        ppt_request = make_pptx_gen_request(dialog, conv)
        ppt_bytes, filename = get_pptx_from_deepinsight(ppt_request)
        utf8_file_name = quote(filename, encoding='utf-8')
        content_disposition = f'attachment; filename={utf8_file_name}'
        response = Response(ppt_bytes.getvalue(), mimetype="application/vnd.openxmlformats-officedocument.presentationml.presentation")
        response.headers["Content-Disposition"] = content_disposition
        response.headers["Content-Type"] = "application/octet-stream"

        return response

    except Exception as e:
        return server_error_response(e)
    


def make_pptx_gen_request(dialog: Dialog, conversation: Conversation):
    # LLM config
    model_config = TenantLLMService.get_model_config(dialog.tenant_id, LLMType.CHAT, dialog.llm_id)
    llm_config = LLMConfig(
        model=model_config["llm_name"],
        base_url=model_config.get("api_base", None) or None,
        api_key=model_config.get("api_key", None) or None,
        setting=LLMSetting(
            temperature=dialog.llm_setting.get("temperature", 0.7),
            top_p=dialog.llm_setting.get("top_p", 1.0),
            frequency_penalty=0,
            presence_penalty=0,
            max_tokens=dialog.llm_setting.get("max_tokens", 8192),
        )
    )
    llm_factory = model_config.get("llm_factory", None) or None
    request = ConferencePPTGenRequest(
        conversation_id=conversation.id,
        args=ChatArgs(
            llm_options=[
                ArgOptionsGeneric[LLMConfig](
                    type=llm_factory,
                    params=llm_config,
                )
            ]
        )
    )
    return request
