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

// --- VARIABLES ---
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

let player = { x: 50, y: 500, w: 20, h: 20, vx: 0, vy: 0, color: '#00f3ff', onGround: false };
let gameState = {
    username: "", level: 1, deaths: 0, kevCoins: 0,
    attempts: 0, bestTime: 99999,
    isPaused: true, isSpeedrun: false,
    ownedSkins: ['#00f3ff'], startTime: 0
};

let platforms = [];
let hazards = [];
let goal = {};
const keys = { right: false, left: false, up: false };
let unsubscribeRank1 = null, unsubscribeRank2 = null;

const PHYS = { grav: 0.6, frict: 0.8, jump: -11 }; // Pas de wall jump physique, juste collisions

// --- ALGORITHME INTELLIGENT DE NIVEAU (FIX 3) ---
function generateSmartLevel(levelNum) {
    platforms = []; hazards = [];
    
    // 1. Définir le Start et le Goal
    let startX = 50, startY = 550;
    let goalX = 820, goalY = 50;
    
    // Sol de départ
    platforms.push({ x: startX - 20, y: startY + 20, w: 100, h: 20 });
    player.x = startX; player.y = startY; player.vx = 0; player.vy = 0;

    // Arrivée
    goal = { x: goalX, y: goalY, w: 40, h: 40 };
    platforms.push({ x: goalX - 10, y: goalY + 40, w: 60, h: 20 });

    // 2. Créer un CHEMIN faisable (Pathfinding inverse)
    // On divise la hauteur en "étages" de saut (environ 100px)
    let steps = 5; 
    let currentY = 500;
    let previousX = startX;

    for (let i = 0; i < steps; i++) {
        // Hauteur de la prochaine plateforme (on monte)
        let nextY = currentY - (80 + Math.random() * 30); 
        
        // Position X : Doit être atteignable depuis previousX (max 180px de saut)
        // Mais on veut que ça bouge (pas tout droit)
        let minX = Math.max(50, previousX - 180);
        let maxX = Math.min(800, previousX + 180);
        
        let nextX = Math.random() * (maxX - minX) + minX;
        
        // Largeur plateforme (plus petit si niveau élevé)
        let w = 100 - (levelNum * 0.5); 
        if (w < 40) w = 40;

        platforms.push({ x: nextX, y: nextY, w: w, h: 20 });

        // Ajouter des leurres (plateformes inutiles ou pièges)
        if (Math.random() > 0.4) {
             let decoyX = (nextX + 300) % 800;
             platforms.push({ x: decoyX, y: nextY, w: w, h: 20 });
             // Piège sur le leurre
             if (levelNum > 2) hazards.push({ x: decoyX + 10, y: nextY - 10, w: w-20, h: 10 });
        }

        previousX = nextX;
        currentY = nextY;
    }

    // Affichage
    document.getElementById('current-level-num').innerText = gameState.isSpeedrun ? "SPEEDRUN" : levelNum;
}

// --- MOTEUR PHYSIQUE ---
function update() {
    if (gameState.isPaused) return;

    // Timer Speedrun
    if (gameState.isSpeedrun) {
        let t = ((Date.now() - gameState.startTime) / 1000).toFixed(2);
        document.getElementById('speedrun-timer').innerText = t + " s";
    }

    // Droite / Gauche
    if (keys.right) player.vx += 1;
    if (keys.left) player.vx -= 1;
    player.vx *= PHYS.frict;
    player.x += player.vx;

    // FIX 2 : BORDURES ECRAN (Pas de mur, juste bloqué)
    if (player.x < 0) { player.x = 0; player.vx = 0; }
    if (player.x > canvas.width - player.w) { player.x = canvas.width - player.w; player.vx = 0; }

    // Collisions X (Plateformes)
    for (let p of platforms) {
        if (rectIntersect(player.x, player.y, player.w, player.h, p.x, p.y, p.w, p.h)) {
            if (player.vx > 0) player.x = p.x - player.w;
            else if (player.vx < 0) player.x = p.x + p.w;
            player.vx = 0;
        }
    }

    // Gravité
    player.vy += PHYS.grav;
    player.y += player.vy;
    player.onGround = false;

    // Collisions Y
    for (let p of platforms) {
        if (rectIntersect(player.x, player.y, player.w, player.h, p.x, p.y, p.w, p.h)) {
            if (player.vy > 0) { // Tombe sur le sol
                player.y = p.y - player.h;
                player.onGround = true;
                player.vy = 0;
            } else if (player.vy < 0) { // Cogne plafond
                player.y = p.y + p.h;
                player.vy = 0;
            }
        }
    }

    // FIX 1 : MORT DANS LE VIDE
    if (player.y > canvas.height) {
        die();
    }
    // Mort par pics
    if (checkHazardCollision()) {
        die();
    }

    // Victoire
    if (rectIntersect(player.x, player.y, player.w, player.h, goal.x, goal.y, goal.w, goal.h)) {
        win();
    }
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
    // Lueur verte
    ctx.shadowBlur = 15; ctx.shadowColor = "#00ff66";
    ctx.fillRect(goal.x, goal.y, goal.w, goal.h);
    ctx.shadowBlur = 0;
    
    // Player
    ctx.fillStyle = player.color; ctx.fillRect(player.x, player.y, player.w, player.h);
}

function gameLoop() { update(); draw(); requestAnimationFrame(gameLoop); }

// --- LOGIQUE JEU ---
function die() {
    // En speedrun, on ne meurt pas vraiment, on respawn juste au début sans perdre le timer
    if (gameState.isSpeedrun) {
        player.x = 50; player.y = 550; player.vx = 0; player.vy = 0;
    } else {
        // En normal, ça compte une mort
        gameState.deaths++;
        saveData(false);
        updateLocalStats();
        // Respawn complet
        player.x = 50; player.y = 550; player.vx = 0; player.vy = 0;
    }
}

function win() {
    if (gameState.isSpeedrun) {
        // FIX 5 : Pas d'alert
        let time = parseFloat(((Date.now() - gameState.startTime) / 1000).toFixed(2));
        
        // UI Feedback
        let timerDisplay = document.getElementById('speedrun-timer');
        timerDisplay.style.color = "#00ff66"; // Vert
        timerDisplay.innerText = "FINI : " + time + "s";
        
        // Save Best time
        if (time < gameState.bestTime) {
            gameState.bestTime = time;
            saveData(true);
        }
        
        gameState.isPaused = true;
        setTimeout(() => {
            timerDisplay.style.color = "red";
            loadMenu();
        }, 2000); // Retour menu après 2s
        
    } else {
        // Normal
        gameState.kevCoins += 100;
        gameState.level++;
        saveData(true);
        generateSmartLevel(gameState.level);
        updateLocalStats();
    }
}

// --- FIREBASE ---
async function login(name) {
    if(!name) return;
    gameState.username = name.toUpperCase(); // FIX 4 : MAJUSCULE
    const userRef = doc(db, "players", gameState.username);
    const snap = await getDoc(userRef);

    if (snap.exists()) {
        const d = snap.data();
        gameState.level = d.level; gameState.deaths = d.deaths;
        gameState.kevCoins = d.kevCoins; gameState.ownedSkins = d.ownedSkins || [];
        gameState.attempts = d.attempts || 0; gameState.bestTime = d.bestTime || 99999;
        player.color = d.activeSkin || '#00f3ff';
    } else {
        await setDoc(userRef, {
            name: gameState.username, level: 1, deaths: 0, kevCoins: 0, attempts: 0, bestTime: 99999,
            ownedSkins: ['#00f3ff'], activeSkin: '#00f3ff'
        });
    }
    document.getElementById('login-overlay').style.display = 'none';
    loadMenu();
    updateLocalStats();
    loadLeaderboards('normal');
}

async function saveData(force = false) {
    if(!gameState.username) return;
    const userRef = doc(db, "players", gameState.username);
    
    let dataToUpdate = {};
    if(gameState.isSpeedrun) {
        dataToUpdate = { attempts: gameState.attempts, bestTime: gameState.bestTime };
    } else {
        dataToUpdate = { 
            level: gameState.level, deaths: gameState.deaths, 
            kevCoins: gameState.kevCoins, activeSkin: player.color 
        };
    }
    
    // Sauvegarde optimisée (pas à chaque frame)
    if (force || gameState.deaths % 5 === 0) {
        await updateDoc(userRef, dataToUpdate);
    }
}

function loadLeaderboards(mode) {
    if (unsubscribeRank1) unsubscribeRank1();
    if (unsubscribeRank2) unsubscribeRank2();

    const list1 = document.getElementById('list-rank-1');
    const list2 = document.getElementById('list-rank-2');
    const title1 = document.getElementById('title-rank-1');
    const title2 = document.getElementById('title-rank-2');

    if (mode === 'normal') {
        title1.innerText = "CLASSEMENT (NIV MAX)";
        title2.innerText = "NOMBRE DE MORTS";
        const q1 = query(collection(db, "players"), orderBy("level", "desc"), limit(10));
        unsubscribeRank1 = onSnapshot(q1, snap => {
            list1.innerHTML = "";
            snap.forEach(d => list1.innerHTML += `<li><span>${d.data().name}</span><span style="color:#00f3ff">${d.data().level} Niv</span></li>`);
        });
        const q2 = query(collection(db, "players"), orderBy("deaths", "desc"), limit(10));
        unsubscribeRank2 = onSnapshot(q2, snap => {
            list2.innerHTML = "";
            snap.forEach(d => list2.innerHTML += `<li><span>${d.data().name}</span><span style="color:#ff0055">${d.data().deaths}</span></li>`);
        });
    } else {
        title1.innerText = "CHRONO RECORD";
        title2.innerText = "ESSAIS";
        const q1 = query(collection(db, "players"), orderBy("bestTime", "asc"), limit(10));
        unsubscribeRank1 = onSnapshot(q1, snap => {
            list1.innerHTML = "";
            snap.forEach(d => {
                let t = d.data().bestTime === 99999 ? "--" : d.data().bestTime + "s";
                list1.innerHTML += `<li><span>${d.data().name}</span><span style="color:#00ff66">${t}</span></li>`
            });
        });
        const q2 = query(collection(db, "players"), orderBy("attempts", "desc"), limit(10));
        unsubscribeRank2 = onSnapshot(q2, snap => {
            list2.innerHTML = "";
            snap.forEach(d => list2.innerHTML += `<li><span>${d.data().name}</span><span style="color:orange">${d.data().attempts || 0}</span></li>`);
        });
    }
}

function updateLocalStats() {
    document.getElementById('info-perso-name').innerText = gameState.username;
    if(gameState.isSpeedrun) {
        document.getElementById('info-perso-1').innerText = `Record: ${gameState.bestTime === 99999 ? '--' : gameState.bestTime}s`;
        document.getElementById('info-perso-2').innerText = `Essais: ${gameState.attempts}`;
        document.getElementById('player-level-display').innerText = "SPEEDRUN";
    } else {
        document.getElementById('info-perso-1').innerText = `Niv: ${gameState.level}`;
        document.getElementById('info-perso-2').innerText = `Morts: ${gameState.deaths}`;
        document.getElementById('player-level-display').innerText = gameState.level;
    }
    document.getElementById('coin-display').innerText = gameState.kevCoins;
    document.getElementById('shop-coin-display').innerText = gameState.kevCoins;
    
    // MAJ des inputs
    document.getElementById('level-select').value = gameState.level;
    document.getElementById('current-level-num').innerText = gameState.level;
}

function loadMenu() {
    gameState.isPaused = true;
    document.getElementById('game-overlay').style.display = 'flex';
    document.getElementById('speedrun-timer').style.display = 'none';
    // Reset affichage
    gameState.isSpeedrun = false;
    updateLocalStats();
    loadLeaderboards('normal');
}

// EVENTS
window.addEventListener('keydown', e => {
    if(e.code === 'ArrowRight') keys.right = true;
    if(e.code === 'ArrowLeft') keys.left = true;
    if(e.code === 'Space' || e.code === 'ArrowUp') {
        if(player.onGround) player.vy = PHYS.jump;
    }
});
window.addEventListener('keyup', e => { if(e.code==='ArrowRight') keys.right=false; if(e.code==='ArrowLeft') keys.left=false; });

document.getElementById('btn-login').onclick = () => login(document.getElementById('username-input').value);

document.getElementById('btn-start').onclick = () => {
    document.getElementById('game-overlay').style.display = 'none';
    gameState.isPaused = false;
    generateSmartLevel(gameState.level);
};

document.getElementById('btn-speedrun').onclick = () => {
    if(!gameState.username) return alert("Login d'abord");
    gameState.isSpeedrun = true;
    gameState.attempts++;
    gameState.startTime = Date.now();
    saveData();
    
    loadLeaderboards('speedrun');
    document.getElementById('game-overlay').style.display = 'none';
    document.getElementById('speedrun-timer').style.display = 'block';
    gameState.isPaused = false;
    
    generateSmartLevel(9999); // Niveau Spécial
    updateLocalStats();
};

// FIX 6 : BOUTONS FOOTER
document.getElementById('btn-restart').onclick = () => {
    die();
    generateSmartLevel(gameState.level);
};
document.getElementById('btn-go').onclick = () => {
    let val = parseInt(document.getElementById('level-select').value);
    if(val > 0) {
        gameState.level = val;
        generateSmartLevel(val);
        updateLocalStats();
    }
};

// Shop & Settings
document.getElementById('btn-shop').onclick = () => { renderShop(); document.getElementById('shop-modal').classList.add('active'); };
document.getElementById('close-shop').onclick = () => document.getElementById('shop-modal').classList.remove('active');
document.getElementById('btn-settings').onclick = () => document.getElementById('settings-modal').classList.add('active');
document.getElementById('close-settings').onclick = () => document.getElementById('settings-modal').classList.remove('active');

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

gameLoop();
