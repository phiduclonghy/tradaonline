# 🧋 TRÀ ĐÁ ĐỘI SÁT HẠCH LÁI XE HƯNG YÊN — Bản online nhiều người thật (Multiplayer)

Quán trà đá online nơi **nhiều người thật vào chung 1 phòng**: mỗi người là 1 nhân vật mặt hoạt hình
trên sân quán 2.5D nhẹ (mượt trên điện thoại), thấy nhau đi lại, ngồi ghế, chat có bong bóng trên đầu,
gọi món — chủ quán người thật làm món rồi mang ra tận bàn. Quầy lúc nào cũng có **Cô Ba** đứng bán thay
khi phòng chưa có chủ quán.

> Khác với bản 3D chơi một mình trước đây, bản này chạy bằng **server Node.js + Socket.io**:
> ai mở link, nhập cùng **mã phòng** (mặc định `HUNGYEN`) là vào chung một quán thật.

## Chạy thử trên máy của bạn

```bash
npm install
npm start
```

- Server mặc định chạy ở `http://localhost:3000` (hoặc cổng trong biến môi trường `PORT` — code đã đọc sẵn `process.env.PORT`).
- Mở trình duyệt vào địa chỉ trên, nhập tên, chọn mặt hoạt hình, chọn vai và **mã phòng**, bấm **Vào quán**.
- **Test 2 người ngay trên 1 máy:** mở thêm 1 cửa sổ ẩn danh (Ctrl+Shift+N) hoặc dùng điện thoại
  (cùng Wi-Fi thì vào `http://<IP-máy-tính>:3000`), nhập **cùng mã phòng** — hai nhân vật sẽ thấy nhau thật.

## Cách chơi

- **Vào phòng:** nhập tên (tối đa 20 ký tự) + mã phòng + chọn 1 trong 8 mặt hoạt hình 😀😎🐱🐰🐻🐼🦊🐸.
  Người vào sau thấy được mọi người đã ở trong phòng, có đếm số người online thật.
- **Vai Chủ quán 👑:** bắt buộc nhập **mật khẩu chủ quán: `1122`** (server kiểm tra, sai là không vào được vai này).
  Mỗi phòng chỉ có **1 chủ quán** — phòng đã có chủ quán thì bạn sẽ vào vai khách (có thông báo).
  Chủ quán rời phòng thì ghế chủ quán trống lại cho người khác nhận.
- **Vai Khách:** không cần mật khẩu.
- **Di chuyển:** chạm/click vào sàn để đi tới (điện thoại chạm là đi), máy tính dùng thêm WASD / phím mũi tên.
- **Ngồi ghế:** tới gần 1 trong 6 bàn, bấm **🪑 Ngồi ghế** (ghế đã có người thì không ngồi trùng được), bấm **Đứng dậy** để đi tiếp.
- **Gọi món 📋:** đang ngồi thì bấm **Gọi món**, chọn 1–3 món: trà đá, trà chanh, nước sấu, nước mơ, nước vối,
  hướng dương, kẹo lạc. Đơn hiện trên đầu khách và trong danh sách đơn của cả phòng.
- **Chủ quán làm món:** bấm **Nhận đơn & làm** (làm ~3 giây ở quầy) → đơn "sẵn sàng" → đi tới gần bàn khách
  rồi bấm **Giao món**. Khách nhận món, cảm ơn trong chat, chủ quán được **+xu** theo giá món,
  bảng điểm phòng (ly đã bán, xu quán) cập nhật cho tất cả.
- **Cô Ba 👩 (NPC của server):** đứng sẵn sau quầy, thỉnh thoảng chào khách mới.
  Phòng **không có chủ quán** → sau ~8 giây cô tự làm và mang đơn ra. Phòng **có chủ quán** →
  cô chỉ "cứu" đơn bị chờ quá 30 giây.
- **Chat 💬:** gõ ở khung chat (tối đa 100 ký tự) — hiện bong bóng trên đầu nhân vật ~5 giây và vào lịch sử chat của phòng.
  Tên và chat có lọc vài từ thô tục cơ bản.

## Kiểm tra tự động (nhiều client)

```bash
# terminal 1
PORT=3199 npm start
# terminal 2
TEST_URL=http://localhost:3199 npm test
```

Script nối nhiều client Socket.io vào cùng phòng và kiểm tra: snapshot khi vào phòng, chủ quán sai mật
khẩu bị từ chối / đúng `1122` được nhận, người thứ ba không chiếm được ghế chủ quán, đồng bộ di chuyển,
chat, ngồi ghế, gọi món → làm → giao, điểm phòng tăng. In `PASS`/`FAIL` từng mục, tất cả đều PASS ở bản này.

## Đưa lên mạng để cả đội vào chơi (deploy miễn phí)

Bạn bè ở xa chỉ vào được khi server chạy trên 1 host công khai. Hai cách phổ biến:

### Cách 1 — Render.com
1. Đưa thư mục này lên GitHub (tạo repo mới, push code lên — **không** cần push `node_modules`).
2. Vào [render.com](https://render.com) → **New → Web Service** → chọn repo vừa tạo.
3. Đặt: **Runtime: Node**, **Build Command:** `npm install`, **Start Command:** `npm start`.
4. Bấm **Create Web Service**. Render tự cấp link dạng `https://ten-dich-vu.onrender.com` và tự đặt
   biến `PORT` — server đã đọc sẵn, không cần chỉnh gì.
   (Gói free có thể "ngủ" khi không ai dùng; lần mở đầu tiên sau khi ngủ chờ ~30–60 giây.)
5. Gửi link cho cả đội, dặn mọi người nhập **cùng mã phòng** (mặc định `HUNGYEN`).

### Cách 2 — Railway
1. Vào [railway.app](https://railway.app) → **New Project → Deploy from GitHub repo** (hoặc `railway up` bằng Railway CLI từ thư mục này).
2. Railway tự nhận diện Node.js; nếu cần đặt **Start Command:** `npm start`.
3. Vào **Settings → Networking → Generate Domain** để lấy link công khai. Railway tự cấp `PORT` qua biến môi trường — code đã xử lý sẵn.
4. Gửi link + mã phòng cho cả đội.

## Cấu trúc thư mục

```
tra-da-multiplayer/
├─ package.json          # express + socket.io, script start / test
├─ server.js             # server: phòng, chủ quán + mật khẩu, ghế, đơn món, Cô Ba NPC, chat, điểm
├─ public/index.html     # client web 2.5D (DOM/CSS, tiếng Việt, ưu tiên mobile)
├─ test-two-clients.js   # test tự động nhiều client
└─ README.md
```

## Giới hạn hiện tại

- Trạng thái giữ **trong bộ nhớ server** (không database): server khởi động lại (hoặc host free cho ngủ rồi
  thức dậy lại từ đầu) là phòng, đơn và điểm **reset hết**. Đủ cho chơi vui theo buổi/ca trực.
- **Không có tài khoản** — ai biết link + mã phòng là vào được; mật khẩu chủ quán `1122` chỉ để phân vai
  trong phòng, không phải bảo mật thật. Đừng chia sẻ link công khai bừa bãi.
- Tối đa **12 người/phòng**, tên tối đa 20 ký tự, chat tối đa 100 ký tự, mỗi đơn tối đa 3 món.
- Đồ hoạ là **2.5D nhẹ bằng DOM/CSS** (không phải Three.js 3D như bản chơi một mình) để nhiều điện thoại
  vào chung một phòng vẫn mượt.
