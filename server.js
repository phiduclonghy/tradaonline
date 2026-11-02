'use strict';
/*
 * TRÀ ĐÁ ĐỘI SÁT HẠCH LÁI XE HƯNG YÊN — server nhiều người thật (Node.js + Express + Socket.io)
 *
 * Trạng thái giữ trong bộ nhớ (không database): server restart là reset hết.
 * Mỗi phòng (room):
 *  - players: Map socketId -> {id,name,face,role:'owner'|'guest',x,y,seat,xu}
 *  - ownerId: socketId của chủ quán người thật (mỗi phòng tối đa 1) hoặc null
 *  - seats: 6 ghế cố định [{id,x,y,takenBy}]
 *  - orders: Map orderId -> {id,customerId,customerName,seatId,items,price,status,byId,createdAt}
 *      status: 'pending' (chờ nhận) -> 'preparing' (đang làm ~3s) -> 'ready' (chờ giao) -> 'delivered'
 *  - score: {cupsSold, totalXu, done} — bảng điểm của phòng
 * NPC Cô Ba (id 'coba'): không có chủ quán -> tự làm + giao đơn sau ~8 giây;
 * có chủ quán -> chỉ "cứu" đơn chờ quá 30 giây.
 */
const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

const OWNER_PASSWORD = '1122';
const MAX_PLAYERS = 12;
const PREP_MS = 3000;               // thời gian làm 1 đơn
const COBA_NO_OWNER_MS = 8000;      // không có chủ quán: Cô Ba nhận đơn sau 8s
const COBA_RESCUE_MS = 30000;       // có chủ quán: Cô Ba chỉ cứu đơn chờ > 30s
const DELIVER_RANGE = 22;           // khoảng cách (% sân) tối đa để giao món

const FACES = ['😀', '😎', '🐱', '🐰', '🐻', '🐼', '🦊', '🐸'];

const MENU = {
  trada:      { label: 'Trà đá',     emoji: '🥤', price: 5, drink: true },
  trachanh:   { label: 'Trà chanh',  emoji: '🍋', price: 7, drink: true },
  nuocsau:    { label: 'Nước sấu',   emoji: '🍹', price: 6, drink: true },
  nuocmo:     { label: 'Nước mơ',    emoji: '🍑', price: 6, drink: true },
  nuocvoi:    { label: 'Nước vối',   emoji: '🍵', price: 4, drink: true },
  huongduong: { label: 'Hướng dương',emoji: '🌻', price: 4, drink: false },
  keolac:     { label: 'Kẹo lạc',    emoji: '🥜', price: 3, drink: false },
};

// Lọc vài từ thô tục cơ bản trong tên và chat
const BAD_WORDS = ['địt', 'đụ ', 'đéo', 'lồn', 'cặc', 'buồi', 'chó đẻ', 'vãi l', 'đệch', 'fuck', 'shit', 'bitch'];
function cleanText(s, maxLen) {
  let t = String(s || '').replace(/\s+/g, ' ').trim().slice(0, maxLen);
  const low = t.toLowerCase();
  for (const w of BAD_WORDS) {
    if (low.includes(w)) t = t.replace(new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '***');
  }
  return t;
}

function normRoom(code) {
  const c = String(code || 'HUNGYEN').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);
  return c || 'HUNGYEN';
}
function clamp(n, lo, hi) { n = Number(n); if (!isFinite(n)) return lo; return Math.max(lo, Math.min(hi, n)); }
function dist(a, b) { const dx = a.x - b.x, dy = a.y - b.y; return Math.sqrt(dx * dx + dy * dy); }

const SEAT_POS = [
  { id: 1, x: 18, y: 48 }, { id: 2, x: 50, y: 48 }, { id: 3, x: 82, y: 48 },
  { id: 4, x: 18, y: 76 }, { id: 5, x: 50, y: 76 }, { id: 6, x: 82, y: 76 },
];

const rooms = new Map(); // code -> room

function getRoom(code) {
  if (!rooms.has(code)) {
    rooms.set(code, {
      code,
      players: new Map(),
      ownerId: null,
      seats: SEAT_POS.map(s => ({ ...s, takenBy: null })),
      orders: new Map(),
      orderSeq: 0,
      score: { cupsSold: 0, totalXu: 0, done: 0 },
    });
  }
  return rooms.get(code);
}

function activeOrders(room) {
  return Array.from(room.orders.values()).map(o => ({
    id: o.id, customerId: o.customerId, customerName: o.customerName, seatId: o.seatId,
    items: o.items, price: o.price, status: o.status, byId: o.byId, createdAt: o.createdAt,
  }));
}

function snapshot(room, youId) {
  return {
    room: room.code,
    youId: youId || null,
    players: Array.from(room.players.values()),
    seats: room.seats,
    orders: activeOrders(room),
    score: room.score,
    ownerId: room.ownerId,
    online: room.players.size,
    menu: MENU,
    faces: FACES,
    coBa: { id: 'coba', name: 'Cô Ba', face: '👩' },
  };
}

function sysChat(room, text, name, face) {
  io.to(room.code).emit('chat', {
    id: 'system', system: true, name: name || 'Hệ thống', face: face || '📣',
    text, ts: Date.now(),
  });
}

function broadcastOrders(room) { io.to(room.code).emit('orders', { orders: activeOrders(room) }); }
function broadcastSeats(room) { io.to(room.code).emit('seats', { seats: room.seats }); }
function broadcastScore(room) {
  io.to(room.code).emit('score', {
    score: room.score,
    players: Array.from(room.players.values()).map(p => ({ id: p.id, xu: p.xu })),
  });
}

// Hoàn tất giao 1 đơn: cộng xu/điểm, báo cả phòng
function completeDelivery(room, order, deliverer) {
  order.status = 'delivered';
  const drinks = order.items.filter(k => MENU[k] && MENU[k].drink).length;
  room.score.cupsSold += drinks;
  room.score.totalXu += order.price;
  room.score.done += 1;
  if (deliverer && deliverer !== 'coba') {
    const p = room.players.get(deliverer);
    if (p) p.xu += order.price;
  }
  room.orders.delete(order.id);
  io.to(room.code).emit('orderDelivered', {
    order: { ...order, items: order.items.slice() },
    byCoBa: deliverer === 'coba',
    byId: deliverer,
    score: room.score,
    ownerXu: deliverer && deliverer !== 'coba' && room.players.get(deliverer)
      ? room.players.get(deliverer).xu : undefined,
  });
  sysChat(room, `❤️ ${order.customerName}: Cảm ơn ${deliverer === 'coba' ? 'Cô Ba' : 'chủ quán'}! Món ngon lắm, +${order.price} xu.`, order.customerName, '😍');
  broadcastOrders(room);
  broadcastScore(room);
}

// Cô Ba nhận 1 đơn: làm ~3 giây rồi tự mang ra bàn
function coBaTakeOrder(room, order) {
  if (order.status !== 'pending' || order.byId) return;
  order.byId = 'coba';
  order.status = 'preparing';
  broadcastOrders(room);
  order.timer = setTimeout(() => {
    if (!room.orders.has(order.id)) return;
    const customer = room.players.get(order.customerId);
    if (!customer) { room.orders.delete(order.id); broadcastOrders(room); return; }
    io.to(room.code).emit('coBaServe', { orderId: order.id, seatId: order.seatId });
    completeDelivery(room, order, 'coba');
  }, PREP_MS);
}

// Quét các phòng mỗi giây: Cô Ba xử lý đơn chờ quá lâu
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    const hasOwner = !!(room.ownerId && room.players.has(room.ownerId));
    const limit = hasOwner ? COBA_RESCUE_MS : COBA_NO_OWNER_MS;
    for (const order of room.orders.values()) {
      if (order.status === 'pending' && !order.byId && now - order.createdAt >= limit) {
        coBaTakeOrder(room, order);
      }
    }
  }
}, 1000);

app.get('/health', (req, res) => res.json({ ok: true, rooms: rooms.size }));

io.on('connection', (socket) => {
  let room = null;
  let me = null;

  socket.on('join', (data = {}) => {
    if (me) return;
    const code = normRoom(data.room);
    const r = getRoom(code);
    if (r.players.size >= MAX_PLAYERS) {
      socket.emit('joinError', { message: `Phòng ${code} đã đủ ${MAX_PLAYERS} người, mời bạn sang phòng khác.` });
      return;
    }
    let role = data.role === 'owner' ? 'owner' : 'guest';
    let notice = null;
    if (role === 'owner') {
      if (String(data.password || '') !== OWNER_PASSWORD) {
        socket.emit('joinError', { message: 'Sai mật khẩu chủ quán! Chỉ chủ quán mới vào được vai này.' });
        return;
      }
      if (r.ownerId && r.players.has(r.ownerId)) {
        role = 'guest';
        notice = 'Phòng đã có chủ quán rồi, bạn vào vai khách nhé. Chủ quán rời đi thì ghế chủ quán sẽ trống lại.';
      }
    }
    room = r;
    socket.join(room.code);
    me = {
      id: socket.id,
      name: cleanText(data.name, 20) || 'Khách',
      face: FACES.includes(data.face) ? data.face : '😀',
      role,
      x: 12 + Math.random() * 76,
      y: 90,
      seat: null,
      xu: 0,
    };
    room.players.set(socket.id, me);
    if (role === 'owner') room.ownerId = socket.id;

    socket.emit('state', snapshot(room, socket.id));
    if (notice) socket.emit('joinNotice', { message: notice });
    socket.to(room.code).emit('playerJoined', { player: me, online: room.players.size });
    io.to(room.code).emit('online', { online: room.players.size });
    sysChat(room, `➕ ${me.name} ${me.face} vừa vào quán${role === 'owner' ? ' (chủ quán)' : ''}.`);
    // Cô Ba thỉnh thoảng chào khách mới
    if (Math.random() < 0.7) {
      const nm = me.name;
      setTimeout(() => {
        if (rooms.has(room.code)) sysChat(room, `Chào ${nm} ghé quán Trà Đá Đội Sát Hạch! Cứ ngồi ghế trống rồi gọi món nhé 🧋`, 'Cô Ba', '👩');
      }, 700);
    }
  });

  function needJoined() { return !!(room && me && room.players.has(socket.id)); }

  socket.on('move', (data = {}) => {
    if (!needJoined()) return;
    // Đang ngồi mà di chuyển = tự đứng dậy
    if (me.seat != null) {
      const seat = room.seats.find(s => s.id === me.seat);
      if (seat && seat.takenBy === socket.id) seat.takenBy = null;
      me.seat = null;
      broadcastSeats(room);
    }
    me.x = clamp(data.x, 2, 98);
    me.y = clamp(data.y, 20, 97);
    socket.to(room.code).emit('move', { id: socket.id, x: me.x, y: me.y });
  });

  socket.on('sit', (data = {}) => {
    if (!needJoined()) return;
    const seat = room.seats.find(s => s.id === Number(data.seatId));
    if (!seat) return;
    if (seat.takenBy && seat.takenBy !== socket.id) {
      socket.emit('sitError', { message: 'Ghế này đã có người ngồi rồi.' });
      return;
    }
    if (me.seat != null && me.seat !== seat.id) {
      const old = room.seats.find(s => s.id === me.seat);
      if (old && old.takenBy === socket.id) old.takenBy = null;
    }
    seat.takenBy = socket.id;
    me.seat = seat.id;
    me.x = seat.x; me.y = seat.y;
    broadcastSeats(room);
    io.to(room.code).emit('move', { id: socket.id, x: me.x, y: me.y, seated: true });
  });

  socket.on('stand', () => {
    if (!needJoined() || me.seat == null) return;
    const seat = room.seats.find(s => s.id === me.seat);
    if (seat && seat.takenBy === socket.id) seat.takenBy = null;
    me.seat = null;
    me.y = Math.min(97, me.y + 8);
    broadcastSeats(room);
    io.to(room.code).emit('move', { id: socket.id, x: me.x, y: me.y });
  });

  socket.on('chat', (data = {}) => {
    if (!needJoined()) return;
    const text = cleanText(data.text, 100);
    if (!text) return;
    io.to(room.code).emit('chat', { id: socket.id, name: me.name, face: me.face, text, ts: Date.now() });
  });

  socket.on('order', (data = {}) => {
    if (!needJoined()) return;
    if (me.seat == null) { socket.emit('orderError', { message: 'Bạn hãy ngồi vào ghế trống trước rồi mới gọi món.' }); return; }
    const items = Array.from(new Set((Array.isArray(data.items) ? data.items : []).filter(k => MENU[k]))).slice(0, 3);
    if (!items.length) { socket.emit('orderError', { message: 'Hãy chọn ít nhất 1 món (tối đa 3 món).' }); return; }
    // Mỗi khách chỉ 1 đơn đang chờ tại một thời điểm
    for (const o of room.orders.values()) {
      if (o.customerId === socket.id) { socket.emit('orderError', { message: 'Đơn trước của bạn chưa xong, chờ quán làm đã nhé.' }); return; }
    }
    const order = {
      id: 'o' + (++room.orderSeq),
      customerId: socket.id,
      customerName: me.name,
      seatId: me.seat,
      items,
      price: items.reduce((s, k) => s + MENU[k].price, 0),
      status: 'pending',
      byId: null,
      createdAt: Date.now(),
      timer: null,
    };
    room.orders.set(order.id, order);
    broadcastOrders(room);
    io.to(room.code).emit('orderNew', { order: activeOrders(room).find(o => o.id === order.id) });
  });

  socket.on('orderAccept', (data = {}) => {
    if (!needJoined()) return;
    if (room.ownerId !== socket.id) { socket.emit('orderError', { message: 'Chỉ chủ quán mới nhận làm đơn được.' }); return; }
    const order = room.orders.get(String(data.orderId || ''));
    if (!order || order.status !== 'pending' || order.byId) return;
    order.byId = socket.id;
    order.status = 'preparing';
    broadcastOrders(room);
    order.timer = setTimeout(() => {
      if (!room.orders.has(order.id) || order.status !== 'preparing' || order.byId !== socket.id) return;
      order.status = 'ready';
      broadcastOrders(room);
      io.to(room.code).emit('orderReady', { orderId: order.id });
    }, PREP_MS);
  });

  socket.on('orderDeliver', (data = {}) => {
    if (!needJoined()) return;
    if (room.ownerId !== socket.id) { socket.emit('orderError', { message: 'Chỉ chủ quán mới giao món được.' }); return; }
    const order = room.orders.get(String(data.orderId || ''));
    if (!order) return;
    if (order.status !== 'ready' || order.byId !== socket.id) {
      socket.emit('orderError', { message: 'Đơn chưa làm xong (hãy nhận đơn và chờ làm ~3 giây).' });
      return;
    }
    const seat = room.seats.find(s => s.id === order.seatId);
    if (!seat || dist(me, seat) > DELIVER_RANGE) {
      socket.emit('orderError', { message: 'Hãy đi tới gần bàn của khách rồi mới giao món.' });
      return;
    }
    if (order.timer) clearTimeout(order.timer);
    completeDelivery(room, order, socket.id);
  });

  socket.on('disconnect', () => {
    if (!room || !me) return;
    // Nhả ghế
    if (me.seat != null) {
      const seat = room.seats.find(s => s.id === me.seat);
      if (seat && seat.takenBy === socket.id) seat.takenBy = null;
    }
    // Huỷ đơn của khách rời phòng; đơn chủ quán đang làm dở -> trả về chờ
    let ordersChanged = false;
    for (const order of Array.from(room.orders.values())) {
      if (order.customerId === socket.id) {
        if (order.timer) clearTimeout(order.timer);
        room.orders.delete(order.id);
        ordersChanged = true;
      } else if (order.byId === socket.id && order.status === 'preparing') {
        if (order.timer) clearTimeout(order.timer);
        order.byId = null;
        order.status = 'pending';
        order.createdAt = Date.now();
        ordersChanged = true;
      }
    }
    room.players.delete(socket.id);
    if (room.ownerId === socket.id) {
      room.ownerId = null;
      io.to(room.code).emit('ownerChanged', { ownerId: null });
      sysChat(room, 'Chủ quán vừa rời phòng — Cô Ba sẽ bán thay cho tới khi có chủ quán mới.');
    }
    io.to(room.code).emit('playerLeft', { id: socket.id, online: room.players.size });
    io.to(room.code).emit('online', { online: room.players.size });
    broadcastSeats(room);
    if (ordersChanged) broadcastOrders(room);
    if (room.players.size === 0) rooms.delete(room.code);
  });
});

server.listen(PORT, () => {
  console.log(`TRÀ ĐÁ ĐỘI SÁT HẠCH LÁI XE HƯNG YÊN (multiplayer) đang chạy: http://localhost:${PORT}`);
});
