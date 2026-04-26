import json
import uuid
import hashlib
import time
from typing import Optional
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles

app = FastAPI()

# ─── In-memory storage ───
users: dict[str, dict] = {}
rooms: dict[str, dict] = {}
ws_to_user: dict[WebSocket, str] = {}
user_to_room: dict[str, str] = {}
# Ghost: store best runs globally {username, score, jumps:[frame,...]}
best_runs: list[dict] = []


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

            if action == "register":
                uname = msg.get("username", "").strip()
                pw = msg.get("password", "")
                if len(uname) < 2 or len(pw) < 3:
                    await ws.send_json({"action": "error", "msg": "Username min 2, password min 3 chars"})
                    continue
                if uname in users:
                    await ws.send_json({"action": "error", "msg": "Username already taken"})
                    continue
                users[uname] = {"password_hash": hash_pw(pw), "wins": 0, "games": 0}
                username = uname
                ws_to_user[ws] = username
                await ws.send_json({"action": "registered", "username": uname})

            elif action == "login":
                uname = msg.get("username", "").strip()
                pw = msg.get("password", "")
                if uname not in users or users[uname]["password_hash"] != hash_pw(pw):
                    await ws.send_json({"action": "error", "msg": "Wrong username or password"})
                    continue
                username = uname
                ws_to_user[ws] = username
                await ws.send_json({"action": "logged_in", "username": uname,
                                    "wins": users[uname]["wins"], "games": users[uname]["games"]})

            elif action == "list_rooms":
                room_list = []
                for rid, r in rooms.items():
                    if len(r["players"]) < 2:
                        room_list.append({"id": rid, "players": r["usernames"], "state": r["state"]})
                await ws.send_json({"action": "room_list", "rooms": room_list})

            elif action == "create_room":
                if not username:
                    await ws.send_json({"action": "error", "msg": "Login first"}); continue
                if username in user_to_room:
                    await ws.send_json({"action": "error", "msg": "Already in a room"}); continue
                rid = str(uuid.uuid4())[:8]
                seed = int(time.time() * 1000)
                rooms[rid] = {"players": [ws], "usernames": [username], "state": "playing", "seed": seed}
                user_to_room[username] = rid
                await ws.send_json({"action": "game_start", "room_id": rid, "seed": seed,
                                    "player_index": 0, "players": [username], "solo": True})

            elif action == "join_room":
                if not username:
                    await ws.send_json({"action": "error", "msg": "Login first"}); continue
                rid = msg.get("room_id", "")
                if rid not in rooms:
                    await ws.send_json({"action": "error", "msg": "Room not found"}); continue
                r = rooms[rid]
                if len(r["players"]) >= 2:
                    await ws.send_json({"action": "error", "msg": "Room is full"}); continue
                if username in user_to_room:
                    await ws.send_json({"action": "error", "msg": "Already in a room"}); continue
                r["players"].append(ws); r["usernames"].append(username)
                user_to_room[username] = rid
                await ws.send_json({"action": "game_start", "room_id": rid, "seed": r["seed"],
                                    "player_index": 1, "players": r["usernames"], "solo": False})
                try:
                    await r["players"][0].send_json({"action": "player_joined_midgame",
                                                     "username": username, "players": r["usernames"]})
                except Exception: pass

            elif action == "jump":
                if not username or username not in user_to_room: continue
                r = rooms.get(user_to_room[username])
                if not r: continue
                for p_ws in r["players"]:
                    if p_ws != ws:
                        await p_ws.send_json({"action": "opponent_jump", "frame": msg.get("frame", 0)})

            elif action == "player_died":
                if not username or username not in user_to_room: continue
                r = rooms.get(user_to_room[username])
                if not r: continue
                for p_ws in r["players"]:
                    if p_ws != ws:
                        await p_ws.send_json({"action": "opponent_died",
                                              "score": msg.get("score", 0), "frame": msg.get("frame", 0)})

            elif action == "game_over":
                if not username or username not in user_to_room: continue
                r = rooms.get(user_to_room[username])
                if not r: continue
                for p_ws in r["players"]:
                    if p_ws != ws:
                        await p_ws.send_json({"action": "opponent_game_over", "score": msg.get("score", 0)})

            # ─── Save best run for ghost system ───
            elif action == "save_run":
                if not username: continue
                sc = msg.get("score", 0)
                jumps = msg.get("jumps", [])
                if sc > 0 and len(jumps) > 0:
                    best_runs.append({"username": username, "score": sc, "jumps": jumps})
                    best_runs.sort(key=lambda x: x["score"], reverse=True)
                    if len(best_runs) > 50: best_runs[:] = best_runs[:50]

            # ─── Get ghost data (best run from server) ───
            elif action == "get_ghost":
                ghost = None
                for run in best_runs:
                    if run["username"] != username:
                        ghost = run; break
                if not ghost and best_runs:
                    ghost = best_runs[0]
                if ghost:
                    await ws.send_json({"action": "ghost_data", "username": ghost["username"],
                                        "score": ghost["score"], "jumps": ghost["jumps"]})
                else:
                    await ws.send_json({"action": "ghost_data", "username": "", "score": 0, "jumps": []})

            # ─── Get leaderboard ───
            elif action == "get_leaderboard":
                lb = [{"username": r["username"], "score": r["score"]} for r in best_runs[:10]]
                await ws.send_json({"action": "leaderboard", "entries": lb})

            elif action == "leave_room":
                if username and username in user_to_room:
                    await _leave_room(ws, username)
                    await ws.send_json({"action": "left_room"})

    except WebSocketDisconnect: pass
    except Exception: pass
    finally:
        if username:
            if username in user_to_room:
                await _leave_room(ws, username)
            ws_to_user.pop(ws, None)


async def _leave_room(ws: WebSocket, username: str):
    rid = user_to_room.pop(username, None)
    if not rid or rid not in rooms: return
    r = rooms[rid]
    if ws in r["players"]:
        idx = r["players"].index(ws); r["players"].pop(idx); r["usernames"].pop(idx)
    for p_ws in r["players"]:
        try: await p_ws.send_json({"action": "opponent_left", "username": username})
        except Exception: pass
    if len(r["players"]) == 0: del rooms[rid]


app.mount("/static", StaticFiles(directory="static"), name="static")
