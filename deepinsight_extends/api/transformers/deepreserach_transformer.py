import asyncio
from copy import deepcopy
from datetime import datetime
import logging
import random
import time
from typing import Any, Dict, Generator, List, Optional
import uuid
from common.constants import LLMType
from api.db.db_models import APIToken, Conversation, Dialog
from api.db.services.api_service import APITokenService
from api.db.services.dialog_service import DialogService
from api.db.services.knowledgebase_service import KnowledgebaseService
from api.db.services.llm_service import TenantLLMService
from enum import Enum
from common.time_utils import current_timestamp,datetime_format
from api.utils.api_utils import generate_confirmation_token
from deepinsight_extends.api.clients.chat_client import stream_chat_async
from deepinsight_extends.api.schemas.deepresearch import ArgOptionsGeneric, ChatRequest, EventType, LLMConfig, LLMSetting, Message, MessageContent, MessageContentType, ChatArgs, MessageToolCallContent, RetrievalArgs, StreamEvent, ConferencePPTGenRequest


class SearchType(Enum):
    KNOWLEADGE = "knowledge"
    WEB_SEARCH = "web_search"
    INTRA_SEARCH = "intra_search"
    CONTENT_MANAGER = "content_manager"



DATA_SOURCE_TO_SEARCH_TYPE = {
    SearchType.KNOWLEADGE.value: "rag_retrieval",
    SearchType.WEB_SEARCH.value: "web_search"
}

DEFAULT_KEY="default"
EXPECTED_TASK_TIME = 60 * 2
MAJOR_STAGE_PREFIX = "thinking_step_"
EVENT_STATE_DEFAULT= "default"
WRITE_EXPERT_KEY="write_experts"
REVIEW_EXPERT_KEY="review_experts"
PARALLEL_DR_KEY="parallel_deepresearch"

def chat(dialog: Dialog, messages: list[dict], stream: bool = True, scene="deep_research", **kwargs):
    start_chat_time = time.time()
    conv: Conversation = kwargs.pop("conv")
    assert messages[-1]["role"] == "user", "The last content of this conversation is not from user."
    
    request = make_chat_request(dialog, conv, messages, scene=scene, **kwargs)
    authorization_key = get_or_generate_authorization_key(dialog, request)
    logging.info(f"Start call deepinsight for conversation id {conv.id}")
    logging.info(f"Start call deepinsight for request: {request}")
    try:
        yield from call_insight(request=request, start_chat_time=start_chat_time, authorization_key=authorization_key)
    except Exception as e:
        logging.error(f"Error in call_insight for conversation id {conv.id}: {type(e).__name__}: {e}", exc_info=True)
        raise
    finally:
        logging.info(f"End call deepinsight for conversation id {conv.id}")


def is_major_stage(event: Optional[str]) -> bool:
    if not event:
        return False
    return (
        event.startswith(MAJOR_STAGE_PREFIX) 
        or event == EventType.report_chunk 
        or event == EventType.final_report
        or event == EventType.thinking_report_outline_generating
        or event == EventType.expert_review_step_generating

    )

class ProgressManager:
    """Async progress updater using asyncio.Queue."""

    def __init__(self, messages: List, delay_range=(2, 5)):
        self.messages = messages
        self.queue: asyncio.Queue = asyncio.Queue()
        self.delay_range = delay_range
        self.progress_index: Optional[int] = None
        self._stopped = False  # 新增：控制循环退出的标志

    async def enqueue(self, progress_ref: Dict):
        """Put a progress message reference into the queue."""
        await self.queue.put(progress_ref)

    async def run(self):
        """Continuously process progress messages with delay."""
        while not self._stopped or not self.queue.empty():
            progress_ref = await self.queue.get()
            if progress_ref is None:
                break  # stop signal
            # 在真正发送给前端之前更新百分比
            if "create_time" in progress_ref and progress_ref.get("percentage", 0) < 99:
                elapsed = time.time() - progress_ref["create_time"]
                new_value = min(99, (elapsed / 1800) * 99)
                progress_ref["percentage"] = round(new_value)
            self._refresh_message_reference(progress_ref)
            # 添加延迟，使用 delay_range 范围内的随机延迟
            delay = random.uniform(self.delay_range[0], self.delay_range[1])
            await asyncio.sleep(delay)
            yield "progress_update"

    def stop(self):
        """Signal the manager to stop gracefully."""
        if not self._stopped:
            self._stopped = True
            # 插入一个 None 作为停止信号，唤醒阻塞的 queue.get()
            try:
                self.queue.put_nowait(None)
            except asyncio.QueueFull:
                pass

    def _refresh_message_reference(self, progress_ref: Dict):
        """Update or insert progress message into messages list."""
        if self.progress_index is None:
            self.messages.append(progress_ref)
            self.progress_index = len(self.messages) - 1
        else:
            self.messages[self.progress_index].update(progress_ref)
            
            
def call_insight(request: ChatRequest, start_chat_time: float, authorization_key: Optional[str] = None) -> Generator[Any, None, None]:
    messages: List = []
    messages_dict: Dict = {}
    tool_call_dict: Dict = {}
    message_id_parent_id: Dict = {}
    current_stage_dict = {expert_key+"_write": None for expert_key in request.write_experts} | {expert_key+"_review": None for expert_key in request.review_experts}
    current_stage_dict[EVENT_STATE_DEFAULT] = None
    progress_message_ref = dict()

    async def _async_run():
        progress_manager = ProgressManager(messages)
        

        stream_iter = stream_chat_async(request, authorization_key)
        stream_task = asyncio.create_task(stream_iter.__anext__(), name="stream_event")
        progress_gen = progress_manager.run()
        progress_task = asyncio.create_task(progress_gen.__anext__(), name="progress_event")
        try:
            while True:
                all_tasks = [t for t in [stream_task, progress_task] if t is not None]
                if not all_tasks:
                    logging.info(f"All tasks are done, exiting _async_run")
                    break
                done, pending = await asyncio.wait(
                    all_tasks,
                    return_when=asyncio.FIRST_COMPLETED
                )
                for task in done:
                    if task.get_name() == "stream_event":
                        try:
                            stream_event = task.result()
                        except StopAsyncIteration:
                            logging.info(f"Stream task is done, exiting _async_run")
                            stream_task = None
                            if "process" in progress_message_ref:
                                progress_message_ref["percentage"] = 100
                                await progress_manager.enqueue(progress_message_ref)
                            progress_manager.stop()
                            continue
                        except Exception as e:
                            stream_task = None
                            if "process" in progress_message_ref:
                                progress_message_ref["percentage"] = 100
                                await progress_manager.enqueue(progress_message_ref)
                            progress_manager.stop()
                            logging.error(f"Error get stream_event: {type(e).__name__}: {e}", exc_info=True)
                            raise
                    
                        cur_expert_key = stream_event.messages[0].parent_message_id
                        cur_expert_key = cur_expert_key if cur_expert_key else EVENT_STATE_DEFAULT
                        if cur_expert_key!=EVENT_STATE_DEFAULT:
                            cur_expert_key = cur_expert_key+"_review" if stream_event.event==EventType.expert_review_step_generating else cur_expert_key+"_write"
                        if is_major_stage(stream_event.event):
                            if current_stage_dict[cur_expert_key] is None:
                                current_stage_dict[cur_expert_key] = stream_event.event
                                if request.scene_type == "deep_research":
                                    start_research_message = dict(
                                        process="",
                                        type="content_markdown",
                                        content="正在研究中",
                                        create_time=time.time(),
                                    )
                                    messages.append(start_research_message)
                            elif stream_event.event != current_stage_dict[cur_expert_key]:
                                flush_previous_stage_parents_to_100(messages_dict, current_stage_dict[cur_expert_key])
                                current_stage_dict[cur_expert_key] = stream_event.event

                        await merge_stream_event_to_messages(
                            stream_event=stream_event,
                            messages=messages,
                            messages_dict=messages_dict,
                            tool_call_dict=tool_call_dict,
                            message_id_parent_id=message_id_parent_id,
                            progress_message_ref=progress_message_ref,
                            progress_manager=progress_manager,
                        )
                        yield _format_answer(messages=messages, start_chat_time=start_chat_time)
                        

                        if stream_task:
                            stream_task = asyncio.create_task(stream_iter.__anext__(), name="stream_event")
                            
                    elif task.get_name() == "progress_event":
                        try:
                            _ = task.result()
                            yield _format_answer(messages=messages, start_chat_time=start_chat_time)
                            # 重新创建 progress_task 以继续处理队列中的消息
                            if progress_task:
                                progress_task = asyncio.create_task(progress_gen.__anext__(), name="progress_event")
                        except StopAsyncIteration:
                            progress_task = None
                            continue
                        except Exception as e:
                            progress_task = None
                            logging.error(f"Error get progress_event: {type(e).__name__}: {e}", exc_info=True)
                            raise
        except Exception as e:
            logging.error(f"Request deepinsight error {e}", exc_info=True)
            raise
        finally:
            pass
        
        
    agen = _async_run()
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        while True:
            try:
                output = loop.run_until_complete(agen.__anext__())
                yield output
            except StopAsyncIteration:
                break
            except Exception as e:
                logging.error("Running deepinsight error", exc_info=True)
                raise
    finally:
        loop.close()


async def merge_stream_event_to_messages(
    stream_event: StreamEvent,
    messages: List, 
    messages_dict: Dict, 
    tool_call_dict: Dict,
    message_id_parent_id: Dict,
    progress_message_ref: Dict,
    progress_manager: ProgressManager,
) -> None:
    process = ""
    if stream_event.event.startswith("think") or stream_event.event == EventType.report_chunk or stream_event.event.startswith("expert_review"):
        process = "think"
    message_type = "content_markdown"
    if (
        stream_event.event.startswith(EventType.interrupt)
        or stream_event.event.startswith("thinking_step")
        or stream_event.event == EventType.thinking_report_outline_generating
        or stream_event.event == EventType.report_chunk
    ):
        message_type = stream_event.event
    elif stream_event.event == EventType.final_report:
        message_type = "result"

    if stream_event.event.startswith(EventType.thinking_tool_calls):
        merge_tool_call_event_to_messages(
            stream_event=stream_event,
            messages=messages,
            messages_dict=messages_dict,
            tool_call_dict=tool_call_dict,
            process=process,
        )
    elif stream_event.event == EventType.error:
        merge_error_event_to_messages(
            stream_event=stream_event,
            messages=messages,
            messages_dict=messages_dict,
            process=process,
            message_type=message_type,
        )
    elif stream_event.event == EventType.progress:
        await merge_progress_to_messages(
            stream_event=stream_event,
            messages=messages,
            progress_message_ref=progress_message_ref,
            process="progress",
            message_type=message_type,
            progress_manager=progress_manager,
        )
    else:
        merge_plain_text_event_to_messages(
            stream_event=stream_event,
            messages=messages,
            messages_dict=messages_dict,
            process=process,
            message_type=message_type,
            message_id_parent_id=message_id_parent_id,
        )


def merge_plain_text_event_to_messages(
        stream_event: StreamEvent,
        messages: List,
        messages_dict: Dict,
        message_id_parent_id: Dict = {},
        process: str = "",
        message_type: str = "content_markdown",
) -> None:
    if DEFAULT_KEY not in message_id_parent_id:
        message_id_parent_id[DEFAULT_KEY] = dict()
    for msg in stream_event.messages:
        if not msg.content_type == MessageContentType.plain_text:
            logging.warning(f"The {stream_event.event} message type currently does not support non-text messages.")
            continue
        if not msg.id in messages_dict:
            if stream_event.event == EventType.thinking_report_outline_generating:
                message_type = "content_markdown"
                tips_message_id = str(uuid.uuid4())
                if msg.parent_message_id and msg.parent_message_id not in message_id_parent_id:
                    message_id_parent_id[msg.parent_message_id] = dict()
                if msg.parent_message_id:
                    message_id_parent_id[msg.parent_message_id][msg.id] = tips_message_id
                else:
                    message_id_parent_id[DEFAULT_KEY][msg.id] = tips_message_id

                tips_message = dict(
                    process=process,
                    type=EventType.thinking_step_outline,
                    content="生成报告大纲",
                    message_id=tips_message_id,
                    percentage=0,
                    create_time=time.time(),
                    parent_message_id=msg.parent_message_id
                )
                messages.append(tips_message)
                messages_dict[tips_message_id] = tips_message
            if stream_event.event == EventType.report_chunk:
                message_type = "content_markdown"
                tips_message_id = str(uuid.uuid4())
                if msg.parent_message_id and msg.parent_message_id not in message_id_parent_id:
                    message_id_parent_id[msg.parent_message_id] = dict()
                if msg.parent_message_id:
                    message_id_parent_id[msg.parent_message_id][msg.id] = tips_message_id
                else:
                    message_id_parent_id[DEFAULT_KEY][msg.id] = tips_message_id

                tips_message = dict(
                    process=process,
                    type=EventType.thinking_step_report_generating,
                    content="正在生成报告",
                    message_id=tips_message_id,
                    percentage=0,
                    create_time=time.time(),
                    parent_message_id=msg.parent_message_id
                )
                messages.append(tips_message)
                messages_dict[tips_message_id] = tips_message
            if stream_event.event == EventType.expert_review_step_generating:

                message_type = "content_markdown"
                tips_message_id = str(uuid.uuid4())
                if msg.parent_message_id and msg.parent_message_id not in message_id_parent_id:
                    message_id_parent_id[msg.parent_message_id] = dict()
                if msg.parent_message_id:
                    message_id_parent_id[msg.parent_message_id][msg.id] = tips_message_id
                else:
                    message_id_parent_id[DEFAULT_KEY][msg.id] = tips_message_id

                tips_message = dict(
                    process=process,
                    type=EventType.expert_review_step_generating,
                    content="正在专家点评",
                    message_id=tips_message_id,
                    percentage=0,
                    create_time=time.time(),
                    parent_message_id=msg.parent_message_id
                )
                messages.append(tips_message)
                messages_dict[tips_message_id] = tips_message

            message = dict(
                process=process,
                type=message_type,
                content=msg.content.text or "",
                message_id=msg.id,
                parent_message_id=msg.parent_message_id or None,
                create_time=time.time(),
            )

            if stream_event.event.startswith("thinking_step"):
                message["percentage"] = 0
            messages.append(message)
            messages_dict[msg.id] = message
        else:

            if msg.parent_message_id:
                parent_message_id = message_id_parent_id.get(msg.parent_message_id, {}).get(
                    msg.id) or msg.parent_message_id
            else:
                parent_message_id = message_id_parent_id.get(DEFAULT_KEY, {}).get(msg.id, None)

            if (
                    stream_event.event == EventType.thinking_report_outline_generating
                    or stream_event.event == EventType.report_chunk
                    or stream_event.event == EventType.expert_review_step_generating
            ):
                message_type = "content_markdown"
            existing_msg = messages_dict[msg.id]
            existing_msg["process"] = process
            existing_msg["type"] = message_type
            existing_msg["content"] += msg.content.text or ""
            existing_msg["parent_message_id"] = parent_message_id
            _update_message_percentage(msg.id, messages_dict)

async def merge_progress_to_messages(
        stream_event: StreamEvent,
        messages: List,
        progress_message_ref: Dict,
        progress_manager: ProgressManager,
        process: str = "progress",
        message_type: str = "content_markdown",
):
    for msg in stream_event.messages:
        if not msg.content_type == MessageContentType.plain_text:
            logging.warning(f"The {stream_event.event} message type currently does not support non-text messages.")
            continue
        if "create_time" not in progress_message_ref:
            progress_message_ref["create_time"] = time.time()
        if "percentage" not in progress_message_ref:
            progress_message_ref["percentage"] = 0

        progress_message_ref["process"] = process
        progress_message_ref["content"] = msg.content.text or ""
        progress_message_ref["type"] = message_type
        
        await progress_manager.enqueue(deepcopy(progress_message_ref))


def merge_tool_call_event_to_messages(
    stream_event: StreamEvent,
    messages: List, 
    messages_dict: Dict,
    tool_call_dict: Dict,
    process: str = "",
) -> None:
    for msg in stream_event.messages:
        if not msg.content_type == MessageContentType.tool_call:
            logging.warning(f"The {stream_event.event} message type currently does not support non-tool-call messages.")
            continue
        if not msg.content.tool_calls:
            logging.warning(f"The {stream_event.event} message tool_call is empty.")
            continue

        if stream_event.event == EventType.thinking_tool_calls: # Tool call request                
            if not msg.id in tool_call_dict:
                tool_call_dict[msg.id] = []
                
            if len(msg.content.tool_calls) > len(tool_call_dict[msg.id]):
                missing = len(msg.content.tool_calls) - len(tool_call_dict[msg.id])
                tool_call_dict[msg.id].extend(
                    MessageToolCallContent(
                        id="",
                        name="",
                        args="",
                        result="",
                    ) for _ in range(missing)
                )
                            
            for tool_call_item in msg.content.tool_calls:
                index = tool_call_item.index
                while len(tool_call_dict[msg.id]) <= index:
                    tool_call_dict[msg.id].append(
                        MessageToolCallContent(
                            id="",
                            name="",
                            args="",
                            result="",
                        )
                    )

                acc_call = tool_call_dict[msg.id][index]
                acc_call.id += tool_call_item.id or ""
                acc_call.name += tool_call_item.name or ""
                acc_call.args += tool_call_item.args or ""
                acc_call.result += tool_call_item.result or ""
                
                if not acc_call.id in messages_dict:
                    message = dict(
                        process=process,
                        type="content_tool_call",
                        content={},
                        message_id=acc_call.id,
                        parent_message_id=msg.parent_message_id or None,
                        create_time=time.time(),
                    )
                    messages_dict[acc_call.id] = message
                    messages.append(message)
                
                if msg.parent_message_id:
                    messages_dict[acc_call.id]["parent_message_id"] = msg.parent_message_id
                messages_dict[acc_call.id]["content"] = acc_call.model_dump() 
                messages_dict[acc_call.id]["type"] = "content_tool_call"
                
            _update_message_percentage(msg.id, messages_dict)
        else: # Tool call result, message id may not equal request id
            for tool_call in msg.content.tool_calls:
                tool_call_request_exist = False
                for msg_id, message_tool_calls in tool_call_dict.items():
                    for cache_tool_call in message_tool_calls:
                        if cache_tool_call.id == tool_call.id:
                            tool_call_request_exist = True
                            cache_tool_call.result = tool_call.result
                            if msg.parent_message_id:
                                messages_dict[tool_call.id]["parent_message_id"] = msg.parent_message_id
                            messages_dict[tool_call.id]["content"] = cache_tool_call.model_dump() 
                            messages_dict[tool_call.id]["type"] = "content_tool_call"
                            _update_message_percentage(msg_id, messages_dict)
                            break
        
                if not tool_call_request_exist:
                    messages.append(
                        dict(
                            process=process,
                            type="content_tool_call",
                            content=MessageToolCallContent(
                                id=tool_call.id or "",
                                name=tool_call.name or "",
                                args=tool_call.args or "",
                                result=tool_call.result or "",
                            ).model_dump(),
                            message_id=msg.id,
                            parent_message_id=msg.parent_message_id or None,
                            create_time=time.time(),
                        )
                    )


def merge_error_event_to_messages(
    stream_event: StreamEvent,
    messages,
    messages_dict,
    process,
    message_type,
):
    message = dict(
        process=process,
        type=message_type,
        content=stream_event.error or "",
        message_id=None,
        parent_message_id=None,
        create_time=time.time(),
    )
    
    messages.append(message)


def _update_message_percentage(current_message_id, messages_dict) -> None:
    # Update percentage for parent message if applicable
    current_message = messages_dict.get(current_message_id, None)
    if current_message and "parent_message_id" in current_message and current_message["parent_message_id"] in messages_dict:
        parent_msg = messages_dict[current_message["parent_message_id"]]
        if "percentage" in parent_msg:
            if parent_msg["percentage"] < 99:
                elapsed = time.time() - parent_msg["create_time"]
                new_value = min(99, (elapsed / EXPECTED_TASK_TIME) * 99)
                parent_msg["percentage"] = round(new_value)
                

def flush_previous_stage_parents_to_100(messages_dict: Dict, stage: Optional[str]) -> None:
    if not stage:
        return
    for msg in list(messages_dict.values()):
        if "percentage" in msg and msg["percentage"] < 100:
            msg["percentage"] = 100
            
            
def _format_answer(messages, start_chat_time: float):
    return {
        "answer": messages, 
        "reference": {}, 
        "audio_binary": "", 
        "prompt": "",
        "created_at": start_chat_time, 
        "updated_at": time.time(), 
        "need_update_conversation": True
    }


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


def make_chat_request(dialog: Dialog, conversation:Conversation, messages: list[dict], scene: str, **kwargs):
    # LLM config 
    model_config = TenantLLMService.get_model_config(dialog.tenant_id, LLMType.CHAT, dialog.llm_id)
    llm_config = LLMConfig(
        model=model_config["llm_name"],
        base_url=model_config.get("api_base", None)  or None,
        api_key=model_config.get("api_key", None)  or None,
        setting=LLMSetting(
            temperature=dialog.llm_setting.get("temperature", 0.7),
            top_p=dialog.llm_setting.get("top_p", 1.0),
            frequency_penalty=0,
            presence_penalty=0,
            max_tokens=dialog.llm_setting.get("max_tokens", 8192),
        )
    )
    llm_factory = model_config.get("llm_factory", None) or None
    
    # # Search types config # {knowledge: [], web_search: false, intra_search: true}
    sources = kwargs.get("sources", {})
    search_types = []
    write_experts = sources.get(WRITE_EXPERT_KEY, [])
    review_experts = sources.get(REVIEW_EXPERT_KEY, [])
    if len(write_experts) >1 and scene=="deep_research":
        scene = PARALLEL_DR_KEY


    for key in DATA_SOURCE_TO_SEARCH_TYPE.keys():
        if sources.get(key):
            search_types.append(DATA_SOURCE_TO_SEARCH_TYPE.get(key, None))

    if SearchType.KNOWLEADGE.value in sources:
        need_insert_knowledge_ids = sources[SearchType.KNOWLEADGE.value]
        if need_insert_knowledge_ids:
            kbs = KnowledgebaseService.get_by_ids(need_insert_knowledge_ids, [])
            embd_ids = [TenantLLMService.split_model_name_and_factory(kb.embd_id)[0] for kb in
                        kbs]
            embd_count = len(set(embd_ids))
            if embd_count == 0:
                raise Exception(
                    "Can not init knowledge tool, embedding model not found"
                )
            elif embd_count > 1:
                raise Exception(f'Datasets use different embedding models: {[kb.embd_id for kb in kbs]}"')
                
            if not DialogService.update_by_id(dialog.id, dict(kb_ids=need_insert_knowledge_ids)):
                raise Exception("Dialog not found!")
        else:
            if not DialogService.update_by_id(dialog.id, dict(kb_ids=[])):
                raise Exception("Dialog not found!")
        
    # Rag retrieval config
    rag_retrieval_config = None
    if "rag_retrieval" in search_types:        
        kbs = sources[SearchType.KNOWLEADGE.value]
        if not kbs:
            raise Exception(
                "You must select at least one knowledge base before using retrieval search."
            )
        rag_retrieval_config = RetrievalArgs(
            dialog_id=dialog.id,
            dataset_ids=kbs,
            page=1,
            page_size=12,
            similarity_threshold=dialog.similarity_threshold,
            vector_similarity_weight=dialog.vector_similarity_weight,
            top_k=dialog.top_k,
            top_n=3,
            rerank_id=dialog.rerank_id,
        )
        
    request = ChatRequest(
        conversation_id=conversation.id,
        messages=[
            Message(
                content=MessageContent(
                    text=messages[-1]["content"],
                ),
                content_type=MessageContentType.plain_text,
            )
        ],
        search_type=search_types,
        scene_type=scene,
        args=ChatArgs(
            llm_options=[
                ArgOptionsGeneric[LLMConfig](
                    type=llm_factory,
                    params=llm_config,
                )
            ],
            retrieval_options=[
                ArgOptionsGeneric[RetrievalArgs](
                    type="ragflow",
                    params=rag_retrieval_config
                )
            ] if rag_retrieval_config else None,
        ),
        write_experts=write_experts,
        review_experts=review_experts,
        expert_name=write_experts[0] if len(write_experts) == 1 else "",
        parallel_expert_review_enable=len(review_experts) > 0 and len(write_experts) > 1,
        expert_review_enable=len(write_experts) < 2,
        allow_user_clarification=True if scene == "deep_research" else False,
        allow_edit_research_brief=True if scene == "deep_research" else False,
        allow_edit_report_outline=False,
    )
    return request

def get_or_generate_authorization_key(dialog: Dialog, request: ChatRequest):
    if not request.search_type or "rag_retrieval" not in request.search_type:
        return None
    tenant_id = dialog.tenant_id
    # First find has generate api key
    objs = APITokenService.query(tenant_id=tenant_id)
    objs = [o.to_dict() for o in objs]
    if len(objs) > 0:
        o = objs[0]
        if not o["beta"]:
            o["beta"] = generate_confirmation_token().replace("ragflow-", "")[:32]
            APITokenService.filter_update([APIToken.tenant_id == tenant_id, APIToken.token == o["token"]], o)
        return o["token"]

    token = generate_confirmation_token()
    obj = {
        "tenant_id": tenant_id,
        "token": token,
        "beta": generate_confirmation_token().replace("ragflow-", "")[:32],
        "create_time": current_timestamp(),
        "create_date": datetime_format(datetime.now()),
        "update_time": None,
        "update_date": None,
    }

    if not APITokenService.save(**obj):
        raise Exception(f"Fail to new a api key for dialog {dialog.id}")

    return token
