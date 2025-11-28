import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js";
import { 
    getFirestore, doc, setDoc, getDoc, updateDoc, 
    onSnapshot, collection, query, orderBy, limit 
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyArB6WjbFka_gMggj4M-9tULR5yPiWYMPU",
  authDomain: "jeukevinplatforme.firebaseapp.com",
  projectId: "jeukevinplatforme",
  storageBucket: "jeukevinplatforme.firebasestorage.app",
  messagingSenderId: "952206740162",
  appId: "1:952206740162:web:993a3bd594ff952fa0495b"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// VARS
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

let player = { x: 50, y: 500, w: 20, h: 20, vx: 0, vy: 0, color: '#00f3ff', onGround: false, wallSliding: false };
let gameState = {
    username: "", level: 1, deaths: 0, kevCoins: 0,
    attempts: 0, bestTime: 99999, // Stats speedrun
    isPaused: true, isSpeedrun: false,
    ownedSkins: ['#00f3ff'], startTime: 0
};

let platforms = [];
let hazards = [];
let goal = {};
const keys = { right: false, left: false, up: false };
let unsubscribeRank1 = null; // Pour couper les écoutes Firebase
let unsubscribeRank2 = null;

// PHYSIQUE
const PHYS = { grav: 0.6, frict: 0.8, jump: -10, wallJumpX: 8, wallJumpY: -10 };

// ==========================================
// GENERATEUR DE NIVEAU (MAZE / DETOURS)
// ==========================================
function generateLevel(levelNum) {
    platforms = [];
    hazards = [];
    let isSpeedrun = gameState.isSpeedrun;
    let seed = levelNum * 999; 

    // 1. Définir Start et Goal (Opposés ou Piégeux)
    // Par défaut : Start milieu bas, Goal milieu haut (mais bloqué)
    let startX = 400; let startY = 550;
    let goalX = 400; let goalY = 50;

    // Variante selon niveau (Pair/Impair)
    if (levelNum % 2 !== 0) { 
        startX = 50; startY = 550; // Bas Gauche
        goalX = 50; goalY = 50;    // Haut Gauche (Faut faire tout le tour)
    }

    platforms.push({ x: startX - 50, y: startY + 40, w: 120, h: 20 }); // Sol départ
    goal = { x: goalX, y: goalY, w: 40, h: 40 };
    platforms.push({ x: goalX - 10, y: goalY + 40, w: 60, h: 20 }); // Sol arrivée

    player.x = startX; player.y = startY; player.vx = 0; player.vy = 0;

    // 2. Création des murs de détour (Les Bloqueurs)
    // On met des grands murs pour empêcher d'aller direct au but
    let wallCount = 3 + (levelNum % 3); // 3 à 5 murs majeurs
    
    for(let i=0; i<wallCount; i++) {
        // Pseudo aléatoire
        let wx = (Math.sin(seed + i) * 300) + 450; 
        let wy = (i * 120) + 100;
        let ww = 150 + (levelNum * 2);
        if(ww > 400) ww = 400;

        // Un mur, c'est juste une plateforme, mais on la place pour gêner
        platforms.push({ x: wx - ww/2, y: wy, w: ww, h: 30 });
        
        // Parfois un mur vertical
        if (i % 2 === 0 && levelNum > 5) {
             platforms.push({ x: wx, y: wy - 100, w: 20, h: 100 });
        }
    }

    // 3. Création des plateformes de passage (Les Helpers)
    // Pour permettre de contourner les murs
    let platCount = 6 + (levelNum % 5);
    for(let j=0; j<platCount; j++) {
        let px = (Math.cos(seed * j) * 400) + 450;
        let py = 500 - (j * 80); // Ça monte
        
        // Évite de chevaucher le départ/arrivée
        if (Math.abs(py - startY) > 50 && Math.abs(py - goalY) > 50) {
            platforms.push({ x: px, y: py, w: 80, h: 20 });
            
            // PIEGES (Rouge)
            if (levelNum > 2 || isSpeedrun) {
                if (Math.tan(seed * j) > 0) { // Random déterministe
                    hazards.push({ x: px + 20, y: py - 10, w: 40, h: 10 });
                }
            }
        }
    }

    // Bordures
    platforms.push({ x: -20, y: 0, w: 20, h: 600 });
    platforms.push({ x: 900, y: 0, w: 20, h: 600 });

    // UI
    document.getElementById('current-level-num').innerText = isSpeedrun ? "SPEEDRUN" : levelNum;
}

// ==========================================
// MOTEUR
// ==========================================
function update() {
    if (gameState.isPaused) return;

    // Timer Speedrun
    if (gameState.isSpeedrun) {
        let t = ((Date.now() - gameState.startTime) / 1000).toFixed(2);
        document.getElementById('speedrun-timer').innerText = t + " s";
    }

    if (keys.right) player.vx += 1;
    if (keys.left) player.vx -= 1;
    player.vx *= PHYS.frict;
    player.x += player.vx;

    player.wallSliding = false;
    let wallDir = 0;
    for (let p of platforms) {
        if (rectIntersect(player.x, player.y, player.w, player.h, p.x, p.y, p.w, p.h)) {
            if (player.vx > 0) { player.x = p.x - player.w; wallDir = 1; }
            else if (player.vx < 0) { player.x = p.x + p.w; wallDir = -1; }
            player.vx = 0;
            if (!player.onGround) player.wallSliding = true;
        }
    }

    player.vy += PHYS.grav;
    if (player.wallSliding && player.vy > 0) player.vy = 2;
    player.y += player.vy;
    player.onGround = false;

    for (let p of platforms) {
        if (rectIntersect(player.x, player.y, player.w, player.h, p.x, p.y, p.w, p.h)) {
            if (player.vy > 0) { player.y = p.y - player.h; player.onGround = true; player.vy = 0; player.wallSliding = false; }
            else if (player.vy < 0) { player.y = p.y + p.h; player.vy = 0; }
        }
    }

    if (player.y > 650 || checkHazardCollision()) die();

    if (rectIntersect(player.x, player.y, player.w, player.h, goal.x, goal.y, goal.w, goal.h)) win();
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Plateformes
    ctx.fillStyle = "black"; ctx.strokeStyle = "#00f3ff"; ctx.lineWidth = 2;
    for (let p of platforms) { ctx.fillRect(p.x, p.y, p.w, p.h); ctx.strokeRect(p.x, p.y, p.w, p.h); }
    
    // Hazards
    ctx.fillStyle = "#ff0055";
    for (let h of hazards) ctx.fillRect(h.x, h.y, h.w, h.h);
    
    // Goal
    ctx.fillStyle = "#00ff66"; ctx.fillRect(goal.x, goal.y, goal.w, goal.h);
    
    // Player
    ctx.fillStyle = player.color; ctx.fillRect(player.x, player.y, player.w, player.h);
}

function gameLoop() { update(); draw(); requestAnimationFrame(gameLoop); }

// ==========================================
// LOGIQUE JEU
// ==========================================
function die() {
    if (gameState.isSpeedrun) {
        // En speedrun, la mort ne reset pas le niveau, juste la position, mais le temps continue ?
        // Ou restart complet ? Disons restart position.
        player.x = 50; player.y = 550; // Simple reset
    } else {
        gameState.deaths++;
        saveData(false); // Sauvegarde légère
    }
    // Refresh position
    generateLevel(gameState.isSpeedrun ? 9999 : gameState.level);
    updateLocalStats();
}

function win() {
    if (gameState.isSpeedrun) {
        let time = (Date.now() - gameState.startTime) / 1000;
        alert("TEMPS : " + time + "s");
        if (time < gameState.bestTime) {
            gameState.bestTime = time;
            saveData(true); // Save force
        }
        gameState.isSpeedrun = false;
        loadMenu();
    } else {
        gameState.kevCoins += 100;
        gameState.level++;
        saveData(true);
        generateLevel(gameState.level);
    }
    updateLocalStats();
}

// ==========================================
// FIREBASE & CLASSEMENTS DYNAMIQUES
// ==========================================
async function login(name) {
    if(!name) return;
    gameState.username = name;
    const userRef = doc(db, "players", name);
    const snap = await getDoc(userRef);

    if (snap.exists()) {
        const d = snap.data();
        gameState.level = d.level; gameState.deaths = d.deaths;
        gameState.kevCoins = d.kevCoins; gameState.ownedSkins = d.ownedSkins || [];
        gameState.attempts = d.attempts || 0; gameState.bestTime = d.bestTime || 99999;
        player.color = d.activeSkin || '#00f3ff';
    } else {
        await setDoc(userRef, {
            name: name, level: 1, deaths: 0, kevCoins: 0, attempts: 0, bestTime: 99999,
            ownedSkins: ['#00f3ff'], activeSkin: '#00f3ff'
        });
    }
    document.getElementById('login-overlay').style.display = 'none';
    loadMenu();
    updateLocalStats();
    loadLeaderboards('normal'); // Par défaut
}

async function saveData(force = false) {
    if(!gameState.username) return;
    // En speedrun, on sauve les essais tous les 30 coups
    if (gameState.isSpeedrun) {
        if (force || gameState.attempts % 30 === 0) {
            const userRef = doc(db, "players", gameState.username);
            await updateDoc(userRef, { attempts: gameState.attempts, bestTime: gameState.bestTime });
        }
    } else {
        // En normal
        if (force || gameState.deaths % 10 === 0) {
            const userRef = doc(db, "players", gameState.username);
            await updateDoc(userRef, { 
                level: gameState.level, deaths: gameState.deaths, 
                kevCoins: gameState.kevCoins, activeSkin: player.color 
            });
        }
    }
}

// Bascule des classements (Requirement 6)
function loadLeaderboards(mode) {
    // Nettoyer les anciens écouteurs
    if (unsubscribeRank1) unsubscribeRank1();
    if (unsubscribeRank2) unsubscribeRank2();

    const list1 = document.getElementById('list-rank-1');
    const list2 = document.getElementById('list-rank-2');
    const title1 = document.getElementById('title-rank-1');
    const title2 = document.getElementById('title-rank-2');

    if (mode === 'normal') {
        title1.innerText = "CLASSEMENT (NIV MAX)";
        title2.innerText = "NOMBRE DE MORTS";

        // Query 1: Niveau
        const q1 = query(collection(db, "players"), orderBy("level", "desc"), limit(10));
        unsubscribeRank1 = onSnapshot(q1, snap => {
            list1.innerHTML = "";
            snap.forEach(d => list1.innerHTML += `<li><span>${d.data().name}</span><span style="color:#00f3ff">${d.data().level} Niv</span></li>`);
        });

        // Query 2: Morts
        const q2 = query(collection(db, "players"), orderBy("deaths", "desc"), limit(10));
        unsubscribeRank2 = onSnapshot(q2, snap => {
            list2.innerHTML = "";
            snap.forEach(d => list2.innerHTML += `<li><span>${d.data().name}</span><span style="color:#ff0055">${d.data().deaths}</span></li>`);
        });

    } else if (mode === 'speedrun') {
        title1.innerText = "CHRONO (LE + BAS)";
        title2.innerText = "NOMBRE D'ESSAIS";

        // Query 1: Temps
        const q1 = query(collection(db, "players"), orderBy("bestTime", "asc"), limit(10));
        unsubscribeRank1 = onSnapshot(q1, snap => {
            list1.innerHTML = "";
            snap.forEach(d => {
                let t = d.data().bestTime;
                if(t === 99999) t = "--";
                list1.innerHTML += `<li><span>${d.data().name}</span><span style="color:#00ff66">${t} s</span></li>`
            });
        });

        // Query 2: Essais
        const q2 = query(collection(db, "players"), orderBy("attempts", "desc"), limit(10));
        unsubscribeRank2 = onSnapshot(q2, snap => {
            list2.innerHTML = "";
            snap.forEach(d => list2.innerHTML += `<li><span>${d.data().name}</span><span style="color:orange">${d.data().attempts || 0}</span></li>`);
        });
    }
}

function updateLocalStats() {
    document.getElementById('info-perso-1').innerText = gameState.isSpeedrun ? 
        `Record: ${gameState.bestTime === 99999 ? '--' : gameState.bestTime} s` : 
        `${gameState.username}: ${gameState.level} Niv`;
        
    document.getElementById('info-perso-2').innerText = gameState.isSpeedrun ? 
        `Essais: ${gameState.attempts}` : 
        `Morts: ${gameState.deaths}`;
        
    document.getElementById('coin-display').innerText = gameState.kevCoins;
    document.getElementById('shop-coin-display').innerText = gameState.kevCoins;
    document.getElementById('player-level-display').innerText = gameState.level;
}

function loadMenu() {
    gameState.isPaused = true;
    document.getElementById('game-overlay').style.display = 'flex';
    document.getElementById('speedrun-timer').style.display = 'none';
}

// EVENTS
window.addEventListener('keydown', e => {
    if(e.code === 'ArrowRight') keys.right = true;
    if(e.code === 'ArrowLeft') keys.left = true;
    if(e.code === 'Space' || e.code === 'ArrowUp') {
        if(player.onGround) player.vy = PHYS.jump;
        else if(player.wallSliding) { player.vy = PHYS.wallJumpY; player.vx = (player.x < 450) ? PHYS.wallJumpX : -PHYS.wallJumpX; }
    }
});
window.addEventListener('keyup', e => { if(e.code==='ArrowRight') keys.right=false; if(e.code==='ArrowLeft') keys.left=false; });

document.getElementById('btn-login').onclick = () => login(document.getElementById('username-input').value);
document.getElementById('btn-start').onclick = () => {
    document.getElementById('game-overlay').style.display = 'none';
    gameState.isPaused = false;
    generateLevel(gameState.level);
};

document.getElementById('btn-speedrun').onclick = () => {
    if(!gameState.username) return alert("Login d'abord");
    gameState.isSpeedrun = true;
    gameState.attempts++; // +1 essai
    gameState.startTime = Date.now();
    saveData(); 
    loadLeaderboards('speedrun'); // Changement des panneaux (Req 6)
    
    document.getElementById('game-overlay').style.display = 'none';
    document.getElementById('speedrun-timer').style.display = 'block';
    gameState.isPaused = false;
    generateLevel(9999); // Niveau spécial
    updateLocalStats();
};

document.getElementById('btn-shop').onclick = () => { renderShop(); document.getElementById('shop-modal').classList.add('active'); };
document.getElementById('close-shop').onclick = () => document.getElementById('shop-modal').classList.remove('active');
document.getElementById('btn-settings').onclick = () => document.getElementById('settings-modal').classList.add('active');
document.getElementById('close-settings').onclick = () => document.getElementById('settings-modal').classList.remove('active');

document.getElementById('btn-download-db').onclick = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(gameState));
    const a = document.createElement('a'); a.href = dataStr; a.download = "kevin_data.json"; document.body.appendChild(a); a.click(); a.remove();
};

// SHOP LOGIC
const SHOP_ITEMS = [ {name:"Bleu",c:"#00f3ff"}, {name:"Rouge",c:"#ff0055"}, {name:"Vert",c:"#00ff66"}, {name:"Orange",c:"#ffaa00"}, {name:"Violet",c:"#bf00ff"}, {name:"Blanc",c:"#ffffff"} ];
function renderShop() {
    const c = document.getElementById('shop-items'); c.innerHTML = "";
    SHOP_ITEMS.forEach(i => {
        const div = document.createElement('div'); div.className = "shop-item";
        div.innerHTML = `<div class="color-preview" style="background:${i.c}"></div><div>${i.name}</div><div>1000 KC</div>`;
        div.onclick = () => {
            if(gameState.kevCoins >= 1000 && !gameState.ownedSkins.includes(i.c)) {
                gameState.kevCoins -= 1000; gameState.ownedSkins.push(i.c); player.color = i.c;
                alert("Acheté !"); saveData(true); updateLocalStats(); renderShop();
            } else if (gameState.ownedSkins.includes(i.c)) { player.color = i.c; alert("Equipé !"); }
        };
        c.appendChild(div);
    });
}

function rectIntersect(x1, y1, w1, h1, x2, y2, w2, h2) { return x2 < x1 + w1 && x2 + w2 > x1 && y2 < y1 + h1 && y2 + h2 > y1; }
function checkHazardCollision() { for (let h of hazards) if (rectIntersect(player.x, player.y, player.w, player.h, h.x, h.y, h.w, h.h)) return true; return false; }

// Loop
gameLoop();
