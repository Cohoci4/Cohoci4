import json
import uuid
import hashlib
import time
import asyncio
from typing import Optional
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles

app = FastAPI()

# ─── In-memory storage ───
users: dict[str, dict] = {}        # username -> {password_hash, wins, games}
rooms: dict[str, dict] = {}        # room_id -> {players: [ws1, ws2], usernames: [u1, u2], state, seed}
ws_to_user: dict[WebSocket, str] = {}
user_to_room: dict[str, str] = {}  # username -> room_id


def hash_pw(pw: str) -> str:
    return hashlib.sha256(pw.encode()).hexdigest()


@app.get("/")
async def index():
    with open("static/index.html", "r") as f:
        return HTMLResponse(f.read())


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    username: Optional[str] = None

    try:
        while True:
            raw = await ws.receive_text()
            msg = json.loads(raw)
            action = msg.get("action")

            # ─── Register ───
            if action == "register":
                uname = msg.get("username", "").strip()
                pw = msg.get("password", "")
                if len(uname) < 2 or len(pw) < 3:
                    await ws.send_json({"action": "error", "msg": "Username min 2 chars, password min 3 chars"})
                    continue
                if uname in users:
                    await ws.send_json({"action": "error", "msg": "Username already taken"})
                    continue
                users[uname] = {"password_hash": hash_pw(pw), "wins": 0, "games": 0}
                username = uname
                ws_to_user[ws] = username
                await ws.send_json({"action": "registered", "username": uname})

            # ─── Login ───
            elif action == "login":
                uname = msg.get("username", "").strip()
                pw = msg.get("password", "")
                if uname not in users or users[uname]["password_hash"] != hash_pw(pw):
                    await ws.send_json({"action": "error", "msg": "Invalid username or password"})
                    continue
                username = uname
                ws_to_user[ws] = username
                await ws.send_json({"action": "logged_in", "username": uname,
                                    "wins": users[uname]["wins"], "games": users[uname]["games"]})

            # ─── List rooms ───
            elif action == "list_rooms":
                room_list = []
                for rid, r in rooms.items():
                    room_list.append({
                        "id": rid,
                        "players": r["usernames"],
                        "state": r["state"],
                    })
                await ws.send_json({"action": "room_list", "rooms": room_list})

            # ─── Create room ───
            elif action == "create_room":
                if not username:
                    await ws.send_json({"action": "error", "msg": "Login first"})
                    continue
                if username in user_to_room:
                    await ws.send_json({"action": "error", "msg": "Already in a room"})
                    continue
                rid = str(uuid.uuid4())[:8]
                rooms[rid] = {
                    "players": [ws],
                    "usernames": [username],
                    "state": "waiting",
                    "seed": int(time.time() * 1000),
                }
                user_to_room[username] = rid
                await ws.send_json({"action": "room_created", "room_id": rid})

            # ─── Join room ───
            elif action == "join_room":
                if not username:
                    await ws.send_json({"action": "error", "msg": "Login first"})
                    continue
                rid = msg.get("room_id", "")
                if rid not in rooms:
                    await ws.send_json({"action": "error", "msg": "Room not found"})
                    continue
                r = rooms[rid]
                if r["state"] != "waiting":
                    await ws.send_json({"action": "error", "msg": "Game already in progress"})
                    continue
                if len(r["players"]) >= 2:
                    await ws.send_json({"action": "error", "msg": "Room is full"})
                    continue
                if username in user_to_room:
                    await ws.send_json({"action": "error", "msg": "Already in a room"})
                    continue
                r["players"].append(ws)
                r["usernames"].append(username)
                user_to_room[username] = rid
                await ws.send_json({"action": "room_joined", "room_id": rid, "players": r["usernames"]})
                # Notify the other player
                for p_ws in r["players"]:
                    if p_ws != ws:
                        await p_ws.send_json({"action": "player_joined", "username": username,
                                              "players": r["usernames"]})
                # Auto-start when 2 players join
                if len(r["players"]) == 2:
                    r["state"] = "playing"
                    for i, p_ws in enumerate(r["players"]):
                        await p_ws.send_json({
                            "action": "game_start",
                            "seed": r["seed"],
                            "player_index": i,
                            "players": r["usernames"],
                        })

            # ─── In-game: relay jump to opponent ───
            elif action == "jump":
                if not username or username not in user_to_room:
                    continue
                rid = user_to_room[username]
                r = rooms.get(rid)
                if not r:
                    continue
                for p_ws in r["players"]:
                    if p_ws != ws:
                        await p_ws.send_json({"action": "opponent_jump", "frame": msg.get("frame", 0)})

            # ─── Player died ───
            elif action == "player_died":
                if not username or username not in user_to_room:
                    continue
                rid = user_to_room[username]
                r = rooms.get(rid)
                if not r:
                    continue
                for p_ws in r["players"]:
                    if p_ws != ws:
                        await p_ws.send_json({"action": "opponent_died",
                                              "score": msg.get("score", 0),
                                              "frame": msg.get("frame", 0)})

            # ─── Game over: report scores ───
            elif action == "game_over":
                if not username or username not in user_to_room:
                    continue
                rid = user_to_room[username]
                r = rooms.get(rid)
                if not r:
                    continue
                for p_ws in r["players"]:
                    if p_ws != ws:
                        await p_ws.send_json({"action": "opponent_game_over",
                                              "score": msg.get("score", 0)})

            # ─── Leave room ───
            elif action == "leave_room":
                if username and username in user_to_room:
                    await _leave_room(ws, username)

    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        if username:
            if username in user_to_room:
                await _leave_room(ws, username)
            ws_to_user.pop(ws, None)


async def _leave_room(ws: WebSocket, username: str):
    rid = user_to_room.pop(username, None)
    if not rid or rid not in rooms:
        return
    r = rooms[rid]
    if ws in r["players"]:
        idx = r["players"].index(ws)
        r["players"].pop(idx)
        r["usernames"].pop(idx)
    # Notify remaining player
    for p_ws in r["players"]:
        try:
            await p_ws.send_json({"action": "opponent_left", "username": username})
        except Exception:
            pass
    # Remove room if empty
    if len(r["players"]) == 0:
        del rooms[rid]
    else:
        r["state"] = "waiting"


app.mount("/static", StaticFiles(directory="static"), name="static")
