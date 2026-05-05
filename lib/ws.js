"use strict";

const crypto = require("crypto");

const WS_MAGIC = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

module.exports = function createWS(server) {
  const clients = new Set();

  server.on("upgrade", (req, socket) => {
    if (req.url !== "/ws") { socket.destroy(); return; }

    const key    = req.headers["sec-websocket-key"];
    const accept = crypto.createHash("sha1").update(key + WS_MAGIC).digest("base64");

    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );

    clients.add(socket);

    socket.on("close", () => clients.delete(socket));
    socket.on("error", () => clients.delete(socket));

    // Respond to client pings
    socket.on("data", (buf) => {
      if (!buf.length) return;
      const opcode = buf[0] & 0x0f;
      if (opcode === 0x9) socket.write(pongFrame());   // ping → pong
      if (opcode === 0x8) { clients.delete(socket); socket.destroy(); } // close
    });
  });

  function broadcast(type, data) {
    if (!clients.size) return;
    const payload = Buffer.from(JSON.stringify({ type, ts: Date.now(), ...data }));
    const frame   = textFrame(payload);
    for (const s of clients) {
      try { s.write(frame); } catch { clients.delete(s); }
    }
  }

  function textFrame(payload) {
    const len = payload.length;
    let header;
    if (len < 126) {
      header = Buffer.from([0x81, len]);
    } else if (len < 65536) {
      header = Buffer.from([0x81, 126, len >> 8, len & 0xff]);
    } else {
      header = Buffer.allocUnsafe(10);
      header[0] = 0x81; header[1] = 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    return Buffer.concat([header, payload]);
  }

  function pongFrame() {
    return Buffer.from([0x8a, 0x00]);
  }

  return { broadcast };
};
