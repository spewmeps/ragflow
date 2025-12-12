import json
import os
import requests
import aiohttp
from typing import Any, Dict, Generator, Optional
from pydantic import ValidationError
from deepinsight_extends.api.schemas.deepresearch import ChatRequest, EventType, StreamEvent

DEEPINSIGHT_API_URL = "DEEPINSIGHT_API_URL"
BASE_URL = os.getenv(DEEPINSIGHT_API_URL, "http://localhost:8888/api/v1").rstrip("/")
API_URL = f"{BASE_URL}/deepinsight/chat"

def stream_chat(request: ChatRequest, authorization_key: Optional[str] = None)-> Generator[StreamEvent, None , None]:
    headers = {}
    if authorization_key:
        headers["Ragflow-Authorization"] = authorization_key
    with requests.post(API_URL, json=request.model_dump(), headers=headers, stream=True) as response:
        response.raise_for_status()
        for line in response.iter_lines(decode_unicode=True):
            if line and line.strip():
                yield parse_stream(line=line)

async def stream_chat_async(request: ChatRequest, authorization_key: Optional[str] = None):
    headers = {}
    if authorization_key:
        headers["Ragflow-Authorization"] = authorization_key

    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(
        total=60 * 60,
        sock_read=60 * 60,
    )) as session:
        async with session.post(API_URL, json=request.model_dump(), headers=headers) as resp:
            buffer = ""

            async for chunk in resp.content.iter_any():   # 不触发 Chunk too big
                buffer += chunk.decode(errors="ignore")

                # 如果你的结构是“每块独立一行”
                # 那么就自己按换行符切
                while "\n" in buffer:
                    line, buffer = buffer.split("\n", 1)
                    if line.strip():
                        yield parse_stream(line)
            if buffer:
                yield parse_stream(buffer)

def parse_stream(line:str)->StreamEvent:
    if line.startswith("data:"):
        line= line[len("data:"):].strip()
    try:
        payload: Dict[str, Any] = json.loads(line)
        event = StreamEvent(**payload)
        return event
    except json.JSONDecodeError:
        return StreamEvent(
            event = EventType.error,
            run_id="",
            conversation_id="",
            error_code = 100_001,
            error_msg=f"Invalid JSON: {line}",
            messages=[],
            metadata=None
        )
    except ValidationError as e:
        return StreamEvent(
            event = EventType.error,
            run_id="",
            conversation_id="",
            error_code = 100_002,
            error_msg=f"Schema validation failed: {e}",
            messages=[],
            metadata=None
        )
    

def fetch_experts_from_dit(expert_type: Optional[str]=None)-> Dict[str, Any]:
    url = f"{BASE_URL}/deepinsight/experts"
    params = {"type":expert_type} if expert_type else {}
    try:
        response = requests.get(url, params=params, timeout=10)
        response.raise_for_status()
        return response.json()
    except requests.RequestException as exc:
        return {"code": 500, "message": f"Request failed: {exc}", "data":None}
