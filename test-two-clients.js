'use strict';
/*
 * Test thật nhiều client Socket.io vào cùng 1 phòng trà đá.
 * Chạy:  (server đang chạy)  TEST_URL=http://localhost:3199 node test-two-clients.js
 * Kiểm tra: vào phòng/snapshot, chủ quán sai mật khẩu bị từ chối, đúng 1122 được nhận,
 * người thứ ba không chiếm được ghế chủ quán, di chuyển, chat, ngồi ghế, gọi món ->
 * chủ quán nhận đơn -> làm xong -> giao món -> điểm phòng tăng.
 * In PASS/FAIL từng assertion, exit 1 nếu có FAIL.
 */
const { io } = require('socket.io-client');

const URL = process.env.TEST_URL || 'http://localhost:3000';
const ROOM = 'TEST' + Date.now();
let failures = 0;
function check(label, ok, extra) {
  console.log((ok ? 'PASS' : 'FAIL') + ' — ' + label + (extra ? ' (' + extra + ')' : ''));
  if (!ok) failures++;
}
function waitEvent(socket, event, timeoutMs, predicate) {
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('timeout chờ event ' + event)), timeoutMs || 5000);
    function handler(data) {
      if (predicate && !predicate(data)) return;
      clearTimeout(to); socket.off(event, handler); resolve(data);
    }
    socket.on(event, handler);
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
function joinAndWaitState(payload) {
  const s = io(URL, { transports: ['websocket', 'polling'] });
  const stateP = waitEvent(s, 'state', 5000);
  s.on('connect', () => s.emit('join', payload));
  return { socket: s, stateP };
}

async function main() {
  // 0) Chủ quán sai mật khẩu -> bị từ chối (joinError), không vào được phòng
  const W = io(URL, { transports: ['websocket', 'polling'] });
  const wErrP = waitEvent(W, 'joinError', 5000);
  W.on('connect', () => W.emit('join', { name: 'KeXau', face: '😀', role: 'owner', password: '9999', room: ROOM }));
  const wErr = await wErrP;
  check('Vào vai chủ quán sai mật khẩu bị từ chối', /mật khẩu/i.test(wErr.message || ''), wErr.message);
  W.close();

  // 1) A vào vai chủ quán với mật khẩu đúng 1122 -> nhận snapshot
  const { socket: A, stateP: aStateP } = joinAndWaitState({ name: 'ChuQuanA', face: '😎', role: 'owner', password: '1122', room: ROOM });
  const aState = await aStateP;
  const aId = A.id;
  const aMe = aState.players.find(p => p.id === aId);
  check('A nhận snapshot khi vào phòng (có mình trong danh sách)', !!aMe && aMe.name === 'ChuQuanA', 'room=' + aState.room);
  check('A vào vai chủ quán thành công với mật khẩu 1122', !!aMe && aMe.role === 'owner' && aState.ownerId === aId);
  check('Snapshot có NPC Cô Ba và 6 ghế', !!aState.coBa && aState.coBa.name === 'Cô Ba' && aState.seats.length === 6);

  // 2) B (khách) vào sau: B thấy A trong snapshot; A nhận playerJoined của B
  const aSeesBP = waitEvent(A, 'playerJoined', 5000, d => d.player && d.player.name === 'KhachB');
  const { socket: B, stateP: bStateP } = joinAndWaitState({ name: 'KhachB', face: '🐱', role: 'guest', room: ROOM });
  const bState = await bStateP;
  const bId = B.id;
  check('B nhận snapshot chứa A (người vào sau thấy người đã ở trong)', bState.players.some(p => p.id === aId && p.name === 'ChuQuanA'), 'players=' + bState.players.length);
  const aSeesB = await aSeesBP;
  check('A nhận playerJoined của B', !!aSeesB && aSeesB.player.id === bId);

  // 3) C cố vào vai chủ quán (đúng mật khẩu) -> bị đẩy xuống vai khách, ownerId vẫn là A
  const { socket: C, stateP: cStateP } = joinAndWaitState({ name: 'KhachC', face: '🐰', role: 'owner', password: '1122', room: ROOM });
  const cNoticeP = waitEvent(C, 'joinNotice', 5000).catch(() => null);
  const cState = await cStateP;
  const cMe = cState.players.find(p => p.id === C.id);
  check('Người thứ ba không chiếm được ghế chủ quán (vào vai khách)', !!cMe && cMe.role === 'guest' && cState.ownerId === aId);
  const cNotice = await cNoticeP;
  check('C nhận thông báo phòng đã có chủ quán', !!cNotice && /đã có chủ quán/i.test(cNotice.message || ''), cNotice && cNotice.message);

  // 4) Di chuyển: A move -> B nhận đúng vị trí
  const moveP = waitEvent(B, 'move', 5000, d => d.id === aId);
  A.emit('move', { x: 33.3, y: 44.4 });
  const mv = await moveP;
  check('B nhận move của A với vị trí mới', Math.abs(mv.x - 33.3) < 0.001 && Math.abs(mv.y - 44.4) < 0.001, 'x=' + mv.x + ' y=' + mv.y);

  // 5) Chat: A chat -> B nhận đúng nội dung
  const chatP = waitEvent(B, 'chat', 5000, d => d.id === aId);
  A.emit('chat', { text: 'Chào cả đội sát hạch!' });
  const ch = await chatP;
  check('B nhận chat của A', ch.text === 'Chào cả đội sát hạch!' && ch.name === 'ChuQuanA', 'text="' + ch.text + '"');

  // 6) B ngồi ghế 2 -> A nhận seats có B ở ghế 2
  const seatsP = waitEvent(A, 'seats', 5000, d => d.seats && d.seats.some(s => s.id === 2 && s.takenBy === bId));
  B.emit('sit', { seatId: 2 });
  await seatsP;
  check('B ngồi ghế 2, A thấy ghế 2 đã có B', true);

  // 7) B gọi món (trà đá + kẹo lạc = 8 xu) -> A (chủ quán) nhận được đơn pending
  const ordersP = waitEvent(A, 'orders', 5000, d => d.orders && d.orders.some(o => o.customerId === bId && o.status === 'pending'));
  B.emit('order', { items: ['trada', 'keolac'] });
  const ordEv = await ordersP;
  const order = ordEv.orders.find(o => o.customerId === bId);
  check('A (chủ quán) nhận được đơn của B', !!order && order.price === 8 && order.items.length === 2, 'order=' + (order && order.id) + ' price=' + (order && order.price));

  // 8) A nhận đơn -> preparing -> (~3s) ready
  const prepP = waitEvent(B, 'orders', 5000, d => d.orders && d.orders.some(o => o.id === order.id && o.status === 'preparing'));
  A.emit('orderAccept', { orderId: order.id });
  await prepP;
  check('Đơn chuyển trạng thái đang làm (preparing)', true);
  const readyP = waitEvent(B, 'orders', 10000, d => d.orders && d.orders.some(o => o.id === order.id && o.status === 'ready'));
  await readyP;
  check('Đơn làm xong sau ~3 giây (ready)', true);

  // 9) A đi tới gần bàn 2 rồi giao món -> B nhận orderDelivered, điểm phòng tăng
  A.emit('move', { x: 50, y: 55 });
  await sleep(250);
  const deliveredP = waitEvent(B, 'orderDelivered', 5000, d => d.order && d.order.id === order.id);
  A.emit('orderDeliver', { orderId: order.id });
  const dv = await deliveredP;
  check('B nhận trạng thái đã giao (delivered)', dv.order.status === 'delivered' && dv.byCoBa === false);
  check('Điểm phòng tăng: ly đã bán >= 1 và xu quán >= 8', dv.score.cupsSold >= 1 && dv.score.totalXu >= 8, 'cups=' + dv.score.cupsSold + ' xu=' + dv.score.totalXu);
  check('Xu của chủ quán A được cộng đúng 8 xu', dv.ownerXu === 8, 'ownerXu=' + dv.ownerXu);

  A.close(); B.close(); C.close();
  console.log(failures === 0 ? 'ALL PASS' : ('FAILED: ' + failures + ' assertion(s)'));
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => { console.log('FAIL — lỗi test: ' + err.message); process.exit(1); });
