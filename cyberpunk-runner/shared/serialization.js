// Compact state encoding for network traffic

export function encodePlayerState(state) {
  return {
    id: state.id,
    d: Math.round(state.distance * 10) / 10,
    l: state.lane,
    j: state.jumping ? 1 : 0,
    s: state.sliding ? 1 : 0,
    o: state.overdrive ? 1 : 0,
    y: Math.round(state.y * 100) / 100,
    hp: state.alive ? 1 : 0,
    sk: state.skin || 0,
    n: state.nickname || 'Runner',
    sc: state.score || 0,
  };
}

export function decodePlayerState(data) {
  return {
    id: data.id,
    distance: data.d,
    lane: data.l,
    jumping: data.j === 1,
    sliding: data.s === 1,
    overdrive: data.o === 1,
    y: data.y,
    alive: data.hp === 1,
    skin: data.sk,
    nickname: data.n,
    score: data.sc,
  };
}

export function encodeWorldState(players) {
  return players.map(encodePlayerState);
}

export function decodeWorldState(data) {
  return data.map(decodePlayerState);
}
