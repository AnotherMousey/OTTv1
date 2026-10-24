/* OTTv1 hand-drawn icons. Presentation only: no network calls or application actions. */
(() => {
'use strict';
if (window.__ottIconsInstalled) return;
window.__ottIconsInstalled = true;
// Hand-drawn vector symbols for the existing OTTv1 UI. No platform emoji artwork.
const ICON_INK='#2b2b2b',Y='#ffd84d',R='#e2433f',B='#9cc7ff',G='#b5e6c0',W='#fff',P='#b9b5c6';
const line=d=>`<path d="${d}" fill="none"/>`,shape=(d,fill=W)=>`<path d="${d}" fill="${fill}"/>`,circle=(x,y,r,fill=W)=>`<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}"/>`,rect=(x,y,w,h,fill=W,rx=3)=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}"/>`;
const face=(x=32,y=32)=>circle(x-5,y,1.3,ICON_INK)+circle(x+5,y,1.3,ICON_INK)+line(`M${x-4} ${y+6} Q${x} ${y+10} ${x+4} ${y+6}`);
const star=(x,y,s=12,fill=Y)=>shape(`M${x} ${y-s} L${x+s*.3} ${y-s*.3} L${x+s} ${y-s*.2} L${x+s*.45} ${y+s*.25} L${x+s*.6} ${y+s} L${x} ${y+s*.58} L${x-s*.6} ${y+s} L${x-s*.45} ${y+s*.25} L${x-s} ${y-s*.2} L${x-s*.3} ${y-s*.3} Z`,fill);
const fez=(x=32,y=19)=>shape(`M${x-12} ${y+11} L${x-8} ${y-8} Q${x} ${y-11} ${x+8} ${y-8} L${x+12} ${y+11} Q${x} ${y+7} ${x-12} ${y+11}Z`,R)+line(`M${x} ${y-9} Q${x-18} ${y-17} ${x-20} ${y-1}`)+rect(x-23,y-1,6,7,ICON_INK,1);
const human=(x=32,y=30)=>shape(`M${x-13} ${y+15} Q${x} ${y+9} ${x+13} ${y+15} L${x+14} ${y+31} Q${x} ${y+35} ${x-14} ${y+31}Z`,B)+circle(x,y,12)+face(x,y-1)+fez(x,y-20);
const paper=()=>shape('M16 8 L41 7 L51 18 L50 56 L14 55 Z')+shape('M41 8 L41 19 L51 18',B);
const arrow=(dir)=>{const map={right:'M13 32 Q30 30 49 32 M37 19 L50 32 L37 46',left:'M51 32 Q34 30 15 32 M27 19 L14 32 L27 46',up:'M32 51 Q30 34 32 15 M19 27 L32 14 L46 27',down:'M32 13 Q30 30 32 49 M19 37 L32 50 L46 37'};return line(map[dir])};
const check=()=>line('M17 33 L27 43 L49 20');
const clock=()=>circle(32,32,23)+line('M32 17 L32 33 L43 39')+circle(32,32,2,Y);
const eye=()=>shape('M6 32 Q31 5 58 32 Q33 58 6 32Z')+circle(32,32,10,B)+circle(32,32,3,ICON_INK);
const book=()=>shape('M8 11 Q20 6 32 14 Q45 6 56 11 L55 52 Q43 47 32 54 Q20 48 9 52Z')+line('M32 14 L32 54 M15 19 Q23 16 27 20 M15 27 Q22 24 27 28 M15 35 L25 35');
const svgParts={
 dice:()=>shape('M9 17 L35 7 L56 19 L53 48 L29 58 L9 44Z',P)+line('M9 17 L31 30 L56 19 M31 30 L29 58')+circle(34,16,2,R)+circle(18,31,2,ICON_INK)+circle(23,44,2,ICON_INK)+circle(42,34,2,ICON_INK)+circle(47,45,2,ICON_INK),
 swords:()=>shape('M13 7 L21 9 L48 42 L41 48 L12 16Z','#dde4ee')+shape('M51 7 L43 9 L16 42 L23 48 L52 16Z','#dde4ee')+line('M36 44 L49 33 M27 44 L14 33')+shape('M42 46 L49 53 L54 48 L48 41Z',R)+shape('M21 46 L14 53 L9 48 L15 41Z',B),
 trophy:()=>shape('M19 8 Q32 5 45 8 L43 28 Q41 39 32 39 Q22 39 21 28Z',Y)+line('M21 14 Q5 9 8 23 Q9 32 22 31 M44 14 Q59 9 56 23 Q54 32 43 31 M32 40 L32 49')+shape('M22 48 L43 48 L47 57 L17 57Z',R)+star(32,23,6),
 lock:()=>line('M21 26 L21 20 Q21 5 33 7 Q44 7 43 22 L43 26')+shape('M13 25 Q32 22 51 26 L50 55 Q33 58 14 54Z',Y)+circle(32,37,3,ICON_INK)+line('M32 40 L32 46'),
 map:()=>shape('M7 14 L24 8 L41 15 L57 9 L56 51 L40 57 L23 50 L8 56Z',B)+line('M24 8 L23 50 M41 15 L40 57')+shape('M12 25 L19 21 L26 28 L34 25 L40 34 L34 43 L25 39 L21 32 L13 35Z',G)+line('M44 22 L51 29 M51 22 L44 29'),
 calendar:()=>shape('M10 14 Q32 11 54 14 L54 55 L9 54Z')+shape('M10 14 L54 14 L54 25 L10 24Z',B)+line('M21 7 L21 19 M43 7 L43 19')+[19,31,43].flatMap(x=>[34,45].map(y=>rect(x-2,y-2,4,4,P,1))).join(''),
 write:()=>shape('M10 13 L40 11 L43 53 L11 55Z')+line('M17 24 L32 23 M17 33 L29 32 M17 43 L26 42')+shape('M30 40 L45 12 L53 16 L37 44 L27 50Z',Y)+line('M45 12 L49 6 L57 11 L53 16 M30 40 L37 44'),
 hat:()=>fez(34,27)+line('M16 43 Q34 37 53 42 M21 51 Q34 47 46 50'),
 pawn:()=>circle(32,14,8,P)+shape('M26 23 L38 23 L36 32 Q35 40 47 46 L47 51 L17 51 L17 46 Q29 40 28 32Z',B)+shape('M16 51 L48 51 L51 58 L13 58Z'),
 globe:()=>circle(32,32,24,B)+shape('M11 18 L20 14 L27 19 L25 29 L34 33 L28 42 L18 39 L15 29Z',G)+shape('M39 15 L47 18 L50 26 L43 33 L45 43 L37 49 L34 36 L37 28Z',G)+line('M8 32 Q32 27 56 32'),
 repeat:()=>line('M12 25 Q20 7 43 16 L50 21 M50 11 L50 23 L38 23 M52 40 Q44 58 21 49 L14 44 M14 54 L14 42 L26 42'),
 shuffle:()=>line('M9 17 L18 17 Q26 17 33 32 Q39 47 48 47 L55 47 M46 39 L56 47 L47 55 M9 47 L18 47 Q26 47 33 32 Q39 17 48 17 L55 17 M46 9 L56 17 L47 25'),
 hide:()=>eye()+line('M9 54 L54 9'),
 eye:()=>eye(),
 flag:()=>line('M15 59 L15 8')+shape('M16 9 Q32 2 51 12 L50 37 Q32 27 16 35Z')+shape('M16 9 L25 7 L25 17 L16 19Z',ICON_INK)+shape('M34 7 L43 8 L43 18 L34 17Z',ICON_INK)+shape('M25 17 L34 17 L34 27 L25 27Z',ICON_INK)+shape('M43 18 L50 21 L50 30 L43 28Z',ICON_INK),
 search:()=>circle(27,26,17)+line('M39 39 L55 55 M17 23 Q19 16 27 16'),
 announce:()=>shape('M9 25 L26 25 L49 12 L49 47 L26 36 L10 37Z',B)+shape('M18 37 L28 37 L32 55 L22 55Z',Y)+line('M27 25 L27 36 M56 21 L61 18 M57 31 L63 31 M56 42 L61 45'),
 person:()=>human(),
 people:()=>human(22,29)+circle(45,22,9)+shape('M36 36 Q46 32 55 38 L57 55 L45 57 L43 43Z',Y),
 plus:()=>line('M32 13 L32 51 M13 32 L51 32'),
 lightning:()=>shape('M34 5 L12 35 L29 34 L24 60 L52 23 L35 25Z',Y),
 trash:()=>shape('M16 21 L49 20 L45 56 Q32 59 20 55Z')+line('M11 20 Q32 16 54 20 M25 12 L39 11 L41 18 M27 29 L28 47 M39 28 L37 47'),
 gear:()=>shape('M25 6 L38 6 L40 15 L48 19 L56 17 L61 29 L54 35 L52 43 L55 50 L44 58 L37 51 L29 51 L22 57 L11 49 L14 41 L11 33 L4 29 L9 17 L18 19 L24 15Z',P)+circle(32,32,11),
 clock:()=>clock(),
 alarm:()=>clock()+line('M15 8 L7 17 M49 8 L57 17 M18 52 L12 59 M46 52 L52 59')+shape('M6 12 Q9 1 20 5Z',Y)+shape('M44 5 Q55 1 58 12Z',Y),
 door:()=>shape('M15 7 L46 8 L47 57 L14 57Z')+shape('M18 10 L40 16 L40 56 L18 51Z',B)+circle(34,34,1.8,Y)+line('M8 57 L55 57'),
 save:()=>shape('M10 8 L46 8 L55 18 L54 56 L9 55Z',B)+shape('M20 8 L42 8 L42 27 L20 27Z')+line('M34 11 L34 22')+shape('M19 37 L46 37 L46 55 L19 55Z')+line('M26 44 L39 44'),
 hourglass:()=>line('M15 7 L49 7 M15 57 L49 57')+shape('M20 8 L44 8 Q47 22 34 32 Q46 42 44 56 L20 56 Q17 42 30 32 Q17 22 20 8Z')+shape('M23 18 L41 18 Q38 26 32 29 Q26 26 23 18Z',Y)+shape('M23 51 Q25 43 32 39 Q39 43 41 51Z',Y),
 cross:()=>circle(32,32,24,'#ffd9d6')+line('M23 23 L41 41 M41 23 L23 41'),
 pencil:()=>shape('M12 43 L43 9 L54 20 L22 53 L8 57Z',Y)+shape('M43 9 L49 4 L60 15 L54 20Z',R)+line('M12 43 L22 53 M20 44 L47 17')+shape('M8 57 L11 48 L17 54Z',ICON_INK),
 check:()=>circle(32,32,24,'#dff3e3')+check(),
 robot:()=>rect(10,16,44,36,B,8)+line('M32 16 L32 8')+circle(32,7,3,Y)+rect(4,28,6,14,P,2)+rect(54,28,6,14,P,2)+circle(22,31,4)+circle(42,31,4)+line('M22 43 L42 43 M28 41 L28 45 M36 41 L36 45'),
 wrench:()=>shape('M37 8 Q48 3 56 11 L47 19 L49 25 L55 26 L61 20 Q62 36 44 36 L22 57 Q15 63 9 56 Q4 50 11 44 L33 23 Q29 14 37 8Z',P)+circle(15,51,2),
 key:()=>circle(22,22,14,Y)+circle(19,20,4)+shape('M33 31 L56 53 L50 59 L44 52 L48 48 L40 40 L36 44 L30 38Z',Y),
 download:()=>arrow('down')+line('M10 45 L10 57 L55 57 L55 45'),
 clipboard:()=>shape('M13 12 L50 13 L51 57 L12 56Z',B)+rect(23,7,18,12,Y)+line('M21 29 L43 29 M21 38 L43 38 M21 47 L35 47'),
 first:()=>line('M15 13 L15 52')+shape('M48 12 L24 32 L48 53Z',B),
 previous:()=>shape('M45 12 L18 32 L45 53Z',B),
 play:()=>shape('M21 11 L50 32 L21 54Z',Y),
 last:()=>line('M49 13 L49 52')+shape('M16 12 L40 32 L16 53Z',B),
 northeast:()=>line('M13 51 L51 13 M26 13 L51 13 L51 38'),
 southwest:()=>line('M51 13 L13 51 M13 26 L13 51 L38 51'),
 burst:()=>shape('M32 5 L38 20 L53 11 L47 28 L61 33 L45 39 L54 55 L36 47 L28 61 L24 44 L7 52 L17 36 L3 27 L21 26 L16 9 L29 19Z',Y)+line('M29 28 L33 38 M35 25 L38 32'),
 pause:()=>shape('M17 12 L27 12 L27 53 L17 53Z',B)+shape('M38 12 L48 12 L48 53 L38 53Z',B),
 stopwatch:()=>circle(32,35,21)+line('M26 7 L38 7 M32 7 L32 14 M48 16 L53 11 M32 23 L32 35 L42 30')+circle(32,35,2,Y),
 dizzy:()=>circle(32,32,24)+line('M17 25 L26 33 M26 25 L17 33 M38 25 L47 33 M47 25 L38 33 M25 45 Q32 40 39 45'),
 handshake:()=>shape('M6 27 L16 17 L29 24 L36 18 L57 31 L45 51 L30 51 L19 41Z',Y)+shape('M27 22 L35 17 L48 20 L54 29 L45 35 L35 28 L29 34 Q22 35 21 30Z')+line('M29 38 L41 47 M35 33 L47 42')+shape('M3 24 L10 17 L20 24 L10 39Z',B)+shape('M49 20 L56 17 L62 25 L55 36 L47 29Z',R),
 crown:()=>shape('M10 16 L23 30 L32 11 L42 30 L55 16 L49 51 L15 51Z',Y)+line('M16 43 L49 43')+circle(32,36,3,R),
 warning:()=>shape('M32 6 L60 55 L4 55Z',Y)+line('M32 23 L32 36')+circle(32,45,2,ICON_INK),
 fire:()=>shape('M34 5 Q39 18 47 24 Q60 36 48 51 Q31 65 17 51 Q3 35 24 18 Q21 31 29 32 Q39 23 34 5Z',R)+shape('M33 31 Q48 47 34 55 Q19 54 24 43Z',Y),
 scroll:()=>shape('M15 10 L50 10 Q58 12 55 21 L46 21 L46 48 Q46 58 34 57 L13 57 L13 48 L20 48 L20 18 L10 18 Q7 9 15 10Z','#fff3c4')+line('M26 23 L39 23 M26 31 L39 31 M26 39 L36 39 M13 48 L36 48 Q31 57 39 57'),
 eyes:()=>`<ellipse cx="22" cy="32" rx="12" ry="18" fill="white"/><ellipse cx="45" cy="32" rx="12" ry="18" fill="white"/>`+circle(25,34,4,ICON_INK)+circle(48,34,4,ICON_INK),
 medal1:()=>shape('M15 6 L27 6 L34 25 L23 29Z',R)+shape('M37 6 L49 6 L41 28 L30 24Z',B)+circle(32,41,17,Y)+line('M29 34 L33 31 L33 50 M27 50 L39 50'),
 medal2:()=>shape('M15 6 L27 6 L34 25 L23 29Z',R)+shape('M37 6 L49 6 L41 28 L30 24Z',B)+circle(32,41,17,'#d6dce4')+line('M25 35 Q32 27 39 35 Q41 40 27 49 L40 49'),
 medal3:()=>shape('M15 6 L27 6 L34 25 L23 29Z',R)+shape('M37 6 L49 6 L41 28 L30 24Z',B)+circle(32,41,17,'#e9b18c')+line('M26 33 Q39 28 39 37 L32 41 Q42 41 38 49 Q32 54 25 48'),
 skull:()=>shape('M10 28 Q8 8 32 8 Q57 8 54 30 L46 42 L45 53 L19 53 L18 42Z')+circle(23,29,6,ICON_INK)+circle(42,29,6,ICON_INK)+shape('M32 36 L28 42 L35 42Z',ICON_INK)+line('M26 46 L26 53 M33 46 L33 53 M39 46 L39 53'),
 sort:()=>line('M20 51 L20 13 M10 23 L20 13 L29 23 M44 13 L44 51 M35 41 L44 51 L54 41'),
 gloves:()=>shape('M11 27 Q7 13 21 12 Q32 12 31 25 L36 24 L40 42 L18 49 L11 37Z',R)+shape('M53 27 Q57 13 43 12 Q32 12 33 25 L28 24 L24 42 L46 49 L53 37Z',B)+line('M18 44 L20 54 L33 50 M46 44 L44 54 L33 50'),
 cricket:()=>shape('M16 40 Q17 27 35 28 Q51 28 50 40Z',G)+circle(45,28,7,G)+line('M50 23 L54 12 M46 22 L43 12 M22 37 L12 49 L6 49 M30 36 L36 51 L47 51 M22 29 L11 24'),
 drum:()=>`<ellipse cx="32" cy="25" rx="23" ry="10" fill="${Y}"/>`+shape('M9 25 L10 49 Q32 61 54 49 L55 25 Q31 40 9 25Z',R)+line('M14 32 L21 51 L31 36 L41 51 L50 32 M15 8 L45 22 M49 7 L23 21'),
 boot:()=>shape('M25 8 L46 10 L42 38 L56 46 L56 55 Q29 59 10 53 L10 45 L23 38Z',P)+line('M24 18 L43 20 M24 27 L42 29 M11 50 L55 51'),
 grimace:()=>circle(32,32,24)+circle(23,25,2,ICON_INK)+circle(41,25,2,ICON_INK)+rect(18,36,29,12)+line('M18 42 L47 42 M25 36 L25 48 M32 36 L32 48 M40 36 L40 48'),
 sleepy:()=>circle(29,35,22)+line('M14 30 Q20 34 25 30 M34 30 Q40 34 45 30')+circle(30,45,3)+line('M41 7 L51 7 L41 16 L52 16 M51 22 L59 22 L51 29 L60 29'),
 sparkle:()=>shape('M30 7 Q32 26 50 29 Q33 32 30 53 Q27 32 8 29 Q27 26 30 7Z',Y)+star(52,12,6)+line('M50 44 L50 56 M44 50 L56 50'),
 gi:()=>shape('M18 8 L32 15 L46 8 L59 25 L49 33 L43 25 L47 56 L17 56 L21 25 L15 33 L5 25Z')+line('M19 9 L37 36 M44 10 L27 35 M17 39 L47 39 M33 39 L27 53 M36 40 L43 51'),
 target:()=>circle(32,33,23)+circle(32,33,15,R)+circle(32,33,7,Y)+line('M32 33 L55 9 M47 8 L47 17 L57 17'),
 folder:()=>shape('M7 18 L23 18 L29 12 L52 14 L53 49 L8 52Z',Y)+shape('M10 27 L58 25 L52 53 L8 54Z','#fff3c4'),
 rocket:()=>shape('M22 38 Q19 17 47 6 Q54 31 35 43Z',B)+circle(37,21,6)+shape('M22 28 L11 32 L10 45 L23 38Z',R)+shape('M35 42 L34 54 L45 49 L47 34Z',R)+shape('M20 43 Q9 45 7 58 Q20 56 26 48Z',Y),
 chart:()=>line('M9 8 L9 55 L59 55')+shape('M17 35 L26 35 L26 53 L17 53Z',B)+shape('M32 25 L41 25 L41 53 L32 53Z',Y)+shape('M47 15 L56 15 L56 53 L47 53Z',R),
 shush:()=>circle(31,32,24)+circle(22,27,2,ICON_INK)+circle(40,27,2,ICON_INK)+shape('M32 55 L32 35 Q32 29 36 31 L39 50 L44 45 L49 50 L45 59Z',Y),
 party:()=>shape('M10 55 L19 20 L44 46Z',Y)+line('M16 39 L29 47 M19 28 L37 43 M32 20 Q24 6 38 8 M43 29 Q58 31 56 20')+circle(48,12,3,R)+star(55,43,5,B)+line('M14 9 L19 13 M5 23 L10 24'),
 star:()=>star(32,31,25),
 wave:()=>shape('M18 33 L16 19 Q17 13 21 17 L25 30 L24 9 Q27 4 30 9 L32 28 L35 7 Q39 4 41 10 L40 29 L47 14 Q52 12 52 18 L46 39 Q46 56 31 56 Q21 57 15 45 L8 34 Q7 29 12 29Z',Y)+line('M7 13 L3 8 M54 35 L61 32'),
 rock:()=>typeof rpsMarkup==='function'?rpsMarkup('R'):circle(32,32,23,P),
 chevron:()=>line('M16 24 Q32 40 48 24'),
};
const ICONS={
 '🎲':['dice','Ngẫu nhiên'],'⚔':['swords','Hỗn chiến'],'🏆':['trophy','Vô địch'],'🔒':['lock','Giải riêng / khóa'],'🗺':['map','Chiến dịch'],'📅':['calendar','Lịch đấu'],'✍':['write','Nộp code'],'🎩':['hat','Trọng tài'],'♟':['pawn','Cờ OTT'],'✊':['rock','Oẳn tù tì'],'🌍':['globe','Mọi người chơi'],'🔁':['repeat','Vòng tròn'],'🔀':['shuffle','Thụy Sĩ'],'🙈':['hide','Ẩn / không thể xem'],'👁':['eye','Hiện'],'🏁':['flag','Kết thúc / về đích'],'🔍':['search','Tìm kiếm'],'📢':['announce','Thông báo'],'👤':['person','Tài khoản'],'👥':['people','Nhiều tài khoản'],'➕':['plus','Thêm'],'⚡':['lightning','Đấu ngay'],'🗑':['trash','Xóa'],'⚙':['gear','Quản lý'],'⏰':['alarm','Hẹn giờ'],'🕘':['clock','Giờ thi đấu'],'🚪':['door','Mở nhận bài'],'💾':['save','Lưu'],'⏳':['hourglass','Đang chờ'],'⌛':['hourglass','Quá thời gian'],'❌':['cross','Lỗi'],'✏':['pencil','Sửa'],'✅':['check','Sẵn sàng'],'🤖':['robot','Bot'],'🔧':['wrench','Đang kiểm tra'],'🔑':['key','Mật khẩu'],'⬇':['download','Tải về'],'📋':['clipboard','Sao chép'],'⏮':['first','Về đầu'],'◀':['previous','Lượt trước'],'▶':['play','Phát / lượt sau'],'⏭':['last','Tới cuối'],'↗':['northeast','Góc đích'],'↙':['southwest','Góc nhà'],'💥':['burst','Ăn quân / va chạm'],'⏸':['pause','Tạm dừng'],'⏱':['stopwatch','Giới hạn thời gian'],'😵':['dizzy','Thua / lỗi trận'],'🤝':['handshake','Hòa'],'👑':['crown','Đội thắng'],'⚠':['warning','Cảnh báo'],'🔥':['fire','Đang thi đấu'],'📜':['scroll','Luật / lịch sử'],'👀':['eyes','Xem trực tiếp'],'🥇':['medal1','Hạng nhất'],'🥈':['medal2','Hạng nhì'],'🥉':['medal3','Hạng ba'],'💀':['skull','Đã loại'],'↕':['sort','Sắp xếp'],'🥊':['gloves','Đang đấu'],'🦗':['cricket','Không có đội'],'🥁':['drum','Chuẩn bị đấu'],'👢':['boot','Loại khỏi vòng'],'😬':['grimace','Vùng nguy hiểm'],'😴':['sleepy','Chưa có lượt'],'✨':['sparkle','Lưu nhân vật'],'🥋':['gi','Luyện tập'],'🎯':['target','Chọn đối thủ'],'📂':['folder','Mở tệp'],'🚀':['rocket','Nộp bot'],'📊':['chart','Bảng xếp hạng'],'🤫':['shush','Riêng tư'],'🎉':['party','Thắng / chúc mừng'],'🎊':['party','Ăn mừng'],'⭐':['star','Ngôi sao'],'👋':['wave','Chào']};
function drawnIcon(key,label='',size=null){const name=ICONS[key]?.[0]||key,title=label||ICONS[key]?.[1]||name;const rawBody=svgParts[name]?.()||svgParts.sparkle();const body=name==='rock'?'<g stroke="none">'+rawBody+'</g>':rawBody;return `<svg class="ott-icon" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" ${size?`width="${size}" height="${size}"`:''} role="img" aria-label="${title}" focusable="false"><g stroke="${ICON_INK}" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round">${body}</g></svg>`}
svgParts.left=()=>arrow('left');svgParts.right=()=>arrow('right');svgParts.tick=()=>check();svgParts.xmark=()=>line('M17 17 L47 47 M47 17 L17 47');
Object.assign(ICONS,{'↺':['repeat','Khôi phục / hoàn tác'],'↻':['repeat','Làm mới'],'⇅':['sort','Sắp xếp'],'←':['left','Quay lại'],'→':['right','Tiếp tục'],'✓':['tick','Đã hoàn thành'],'✗':['xmark','Không đạt'],'✕':['xmark','Đóng'],'▸':['play','Mở chi tiết'],'▾':['chevron','Đóng chi tiết']});

const tokenPattern = /\p{Extended_Pictographic}(?:[\uFE0F\uFE0E])?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F)?)*|[↺↻⇅←→✓✗✕▸▾]/gu;
const excluded = 'script,style,textarea,pre,code,.ott-icon,[contenteditable]';
const generatedLabels = new WeakSet();
const svgMarkers = new WeakMap();

function keyOf(token) {
  return token.replace(/[\uFE0F\uFE0E]/g, '');
}

function knownToken(token) {
  return Object.prototype.hasOwnProperty.call(ICONS, keyOf(token));
}

function withoutIcons(text) {
  return text.replace(tokenPattern, token => knownToken(token) ? '' : token);
}

function createIcon(key) {
  const template = document.createElement('template');
  // Only the fixed, locally defined icon catalogue is passed to this renderer.
  template.innerHTML = drawnIcon(key);
  return template.content.firstElementChild;
}

function decorateSVGText(label, token) {
  const old = svgMarkers.get(label);
  if (old) old.remove();
  const icon = createIcon(keyOf(token));
  const size = parseFloat(label.getAttribute('font-size')) || 28;
  const x = parseFloat(label.getAttribute('x')) || 0;
  const y = parseFloat(label.getAttribute('y')) || 0;
  const anchor = label.getAttribute('text-anchor');
  const offset = anchor === 'middle' ? size / 2 : anchor === 'end' ? size : 0;
  icon.setAttribute('x', x - offset);
  icon.setAttribute('y', y - size * 0.85);
  icon.setAttribute('width', size);
  icon.setAttribute('height', size);
  icon.style.width = size + 'px';
  icon.style.height = size + 'px';
  label.before(icon);
  svgMarkers.set(label, icon);
  label.textContent = withoutIcons(label.textContent);
}

function replaceText(node) {
  const text = node.nodeValue;
  const parent = node.parentElement;
  if (!text || !parent || !node.isConnected || parent.closest(excluded)) return;
  const matches = [...text.matchAll(tokenPattern)].filter(match => knownToken(match[0]));
  if (!matches.length) return;

  // Native option rows cannot contain SVG. Keep their values and plain labels;
  // show the selected symbol next to the field's existing label instead.
  const option = parent.closest('option');
  if (option) {
    if (!option.hasAttribute('value')) option.setAttribute('value', option.value);
    option.dataset.ottIcon = keyOf(matches[0][0]);
    node.nodeValue = withoutIcons(text);
    return;
  }

  if (parent.closest('svg')) {
    const label = parent.closest('text');
    if (label) decorateSVGText(label, matches[0][0]);
    return;
  }

  const fragment = document.createDocumentFragment();
  const hasText = withoutIcons(text).trim().length > 0;
  if (hasText && generatedLabels.has(parent)) {
    parent.removeAttribute('aria-label');
    generatedLabels.delete(parent);
  }
  let cursor = 0;
  for (const match of matches) {
    fragment.append(document.createTextNode(text.slice(cursor, match.index)));
    const key = keyOf(match[0]);
    const icon = createIcon(key);
    if (hasText) {
      icon.setAttribute('aria-hidden', 'true');
      icon.removeAttribute('role');
      icon.removeAttribute('aria-label');
    } else if (parent.matches('button,a') &&
               (!parent.hasAttribute('aria-label') || generatedLabels.has(parent))) {
      parent.setAttribute('aria-label', parent.title || ICONS[key][1]);
      generatedLabels.add(parent);
      icon.setAttribute('aria-hidden', 'true');
    }
    fragment.append(icon);
    cursor = match.index + match[0].length;
  }
  fragment.append(document.createTextNode(text.slice(cursor)));
  node.replaceWith(fragment);
}

function elementsIn(root, selector) {
  if (!root.querySelectorAll) return [];
  return [
    ...(root.matches?.(selector) ? [root] : []),
    ...root.querySelectorAll(selector),
  ];
}

function decorateSelects(root) {
  elementsIn(root, 'select').forEach(select => {
    const update = () => {
      const key = select.selectedOptions[0]?.dataset.ottIcon;
      const title = select.closest('label')?.querySelector(':scope > span');
      if (!title) return;
      let marker = title.querySelector('.ott-select-symbol');
      if (!key) {
        marker?.remove();
        return;
      }
      if (!marker) {
        marker = document.createElement('span');
        marker.className = 'ott-select-symbol';
        marker.setAttribute('aria-hidden', 'true');
        title.prepend(marker);
      }
      marker.replaceChildren(createIcon(key), document.createTextNode(' '));
    };
    update();
    if (!select.dataset.ottDecorated) {
      select.dataset.ottDecorated = '1';
      select.addEventListener('change', update);
    }
  });
}

function decorateFields(root) {
  elementsIn(root, 'input[placeholder]').forEach(input => {
    const text = input.getAttribute('placeholder');
    const first = [...text.matchAll(tokenPattern)].find(match => knownToken(match[0]));
    if (!first) return;
    input.placeholder = withoutIcons(text).trim();
    if (!input.hasAttribute('aria-label') && !input.labels?.length) {
      input.setAttribute('aria-label', input.placeholder);
    }
    if (keyOf(first[0]) === '🔍') input.classList.add('ott-search-field');
  });
}

function scan(root) {
  if (root.nodeType === Node.TEXT_NODE) {
    replaceText(root);
    return;
  }
  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return;
  if (root.nodeType === Node.ELEMENT_NODE && root.closest(excluded)) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach(replaceText);
  decorateSelects(root);
  if (root.matches?.('option') && root.parentElement) decorateSelects(root.parentElement);
  decorateFields(root);
}

function start() {
  scan(document.body);
  const options = { childList: true, subtree: true, characterData: true };
  const observer = new MutationObserver(records => {
    // Disconnect while decorating so our own SVG insertions do not form a loop.
    observer.disconnect();
    try {
      for (const record of records) {
        if (record.type === 'characterData') replaceText(record.target);
        else record.addedNodes.forEach(scan);
      }
    } finally {
      observer.observe(document.body, options);
    }
  });
  observer.observe(document.body, options);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}
})();
