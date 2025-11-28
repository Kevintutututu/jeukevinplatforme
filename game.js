// ==========================================
// 1. CONFIGURATION FIREBASE & IMPORTS
// ==========================================
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

// Initialisation
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// ==========================================
// 2. VARIABLES DU JEU
// ==========================================
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// État du joueur
let player = {
    x: 50, y: 300, 
    w: 20, h: 20, 
    vx: 0, vy: 0, 
    color: '#8A2BE2', // Violet par défaut
    onGround: false,
    wallSliding: false,
    wallDir: 0 // -1 gauche, 1 droite
};

// Données globales
let gameState = {
    level: 1,
    deaths: 0,
    kevCoins: 0,
    playerName: "Invité_" + Math.floor(Math.random() * 1000),
    isPaused: true,
    levelsCompleted: [] // Pour éviter de farmer l'argent sur le même niveau
};

// Physique
const PHYS = {
    grav: 0.5,
    frict: 0.8,
    speed: 5,
    jump: -10,
    wallSlideSpeed: 2,
    wallJumpX: 6,
    wallJumpY: -9
};

// Le niveau actuel (sera généré)
let platforms = [];
let hazards = []; // Zones rouges
let goal = {};    // Zone verte

// Contrôles
const keys = { right: false, left: false, up: false };

// ==========================================
// 3. GÉNÉRATION PROCÉDURALE (Les 1000 Niveaux)
// ==========================================
// Fonction pseudo-aléatoire pour que le niveau X soit toujours le même pour tout le monde
function pseudoRandom(input) {
    let t = input += 0.618033988749895;
    return Math.abs((Math.sin(t) * 10000) % 1);
}

function generateLevel(levelNum) {
    platforms = [];
    hazards = [];
    
    // Difficulté progressive
    let gapSize = 50 + (levelNum * 2); // Les trous grandissent
    if (gapSize > 150) gapSize = 150;  // Max limite
    
    let platformCount = 5 + Math.floor(levelNum / 5); 
    if (platformCount > 30) platformCount = 30;

    // 1. Sol de départ (Toujours là)
    platforms.push({ x: 0, y: 500, w: 200, h: 40, type: 'normal' });
    player.x = 50; player.y = 400; player.vx = 0; player.vy = 0;

    let currentX = 200;
    let currentY = 500;

    // 2. Génération des plateformes
    for (let i = 0; i < platformCount; i++) {
        // RNG basé sur le niveau et l'index de la plateforme
        let rngH = pseudoRandom(levelNum * 100 + i);
        let rngW = pseudoRandom(levelNum * 200 + i);
        let rngType = pseudoRandom(levelNum * 300 + i);

        // Distance du saut (X)
        let dist = 60 + (rngW * 80); // Entre 60 et 140px de saut
        currentX += dist;

        // Hauteur (Y) - ça monte et ça descend
        let heightChange = (rngH * 200) - 100; 
        currentY += heightChange;
        
        // Garde-fous (pour ne pas sortir de l'écran ou être impossible)
        if (currentY > 550) currentY = 450;
        if (currentY < 100) currentY = 200;

        let pWidth = 60 + (rngW * 100);
        let pHeight = 20 + (rngH * 30);

        // Ajout de murs verticaux (difficulté > niv 5)
        if (levelNum > 5 && rngType > 0.7) {
            // Mur haut pour wall jump
            platforms.push({ x: currentX, y: currentY - 100, w: 30, h: 200, type: 'wall' });
            currentX += 40; // On décale la prochaine plateforme après le mur
        } else {
            // Plateforme classique
            platforms.push({ x: currentX, y: currentY, w: pWidth, h: pHeight, type: 'normal' });
            
            // Ajout de pics rouges (difficulté > niv 3)
            if (levelNum > 3 && rngType < 0.3) {
                hazards.push({ 
                    x: currentX + (pWidth/2) - 10, 
                    y: currentY - 15, 
                    w: 20, h: 15 
                });
            }
        }
    }

    // 3. Zone d'arrivée (Verte)
    let finalP = platforms[platforms.length - 1];
    goal = { 
        x: finalP.x + finalP.w + 50, 
        y: finalP.y - 50, 
        w: 40, h: 40 
    };
    // Petite plateforme sous l'arrivée
    platforms.push({ x: goal.x - 10, y: goal.y + 40, w: 60, h: 20, type: 'normal' });

    // Mise à jour de l'interface
    document.getElementById('level-indicator').innerText = "Niveau " + levelNum;
    updateHUD();
}

// ==========================================
// 4. MOTEUR DU JEU & PHYSIQUE
// ==========================================
function update() {
    if (gameState.isPaused) return;

    // 1. Mouvement Horizontal
    if (keys.right) player.vx += 1;
    if (keys.left) player.vx -= 1;
    
    player.vx *= PHYS.frict;
    player.x += player.vx;

    // Collisions Horizontales (Murs)
    player.wallSliding = false;
    player.wallDir = 0;

    for (let p of platforms) {
        if (rectIntersect(player.x, player.y, player.w, player.h, p.x, p.y, p.w, p.h)) {
            // Collision détectée
            if (player.vx > 0) { // Venait de la gauche
                player.x = p.x - player.w;
                player.wallDir = 1; // Mur à droite
            } else if (player.vx < 0) { // Venait de la droite
                player.x = p.x + p.w;
                player.wallDir = -1; // Mur à gauche
            }
            player.vx = 0;
            
            // Si on est en l'air et qu'on touche un mur => Wall Slide
            if (!player.onGround) {
                player.wallSliding = true;
            }
        }
    }

    // 2. Mouvement Vertical
    player.vy += PHYS.grav;
    
    // Si on glisse sur un mur, on tombe moins vite
    if (player.wallSliding && player.vy > 0) {
        if (player.vy > PHYS.wallSlideSpeed) player.vy = PHYS.wallSlideSpeed;
    }

    player.y += player.vy;
    player.onGround = false;

    // Collisions Verticales (Sol/Plafond)
    for (let p of platforms) {
        if (rectIntersect(player.x, player.y, player.w, player.h, p.x, p.y, p.w, p.h)) {
            if (player.vy > 0) { // Tombe sur le sol
                player.y = p.y - player.h;
                player.onGround = true;
                player.vy = 0;
                player.wallSliding = false; // Pas de glissade si on est au sol
            } else if (player.vy < 0) { // Cogne le plafond
                player.y = p.y + p.h;
                player.vy = 0;
            }
        }
    }

    // 3. Mort (Chute ou Pics)
    if (player.y > canvas.height + 100 || checkHazardCollision()) {
        die();
    }

    // 4. Victoire
    if (rectIntersect(player.x, player.y, player.w, player.h, goal.x, goal.y, goal.w, goal.h)) {
        winLevel();
    }
}

function draw() {
    // Fond
    ctx.fillStyle = "#87CEEB";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Caméra (Suit le joueur)
    ctx.save();
    let camX = -player.x + canvas.width / 3;
    // On bloque la caméra pour ne pas voir avant le début
    if (camX > 0) camX = 0; 
    ctx.translate(camX, 0);

    // Plateformes (Noires)
    ctx.fillStyle = "black";
    for (let p of platforms) {
        ctx.fillRect(p.x, p.y, p.w, p.h);
    }

    // Pics (Rouges)
    ctx.fillStyle = "red";
    for (let h of hazards) {
        ctx.beginPath();
        ctx.moveTo(h.x, h.y + h.h);
        ctx.lineTo(h.x + h.w / 2, h.y);
        ctx.lineTo(h.x + h.w, h.y + h.h);
        ctx.fill();
    }

    // Arrivée (Verte)
    ctx.fillStyle = "#00ff00";
    ctx.fillRect(goal.x, goal.y, goal.w, goal.h);

    // Joueur
    ctx.fillStyle = player.color;
    ctx.fillRect(player.x, player.y, player.w, player.h);

    ctx.restore();
}

function gameLoop() {
    update();
    draw();
    requestAnimationFrame(gameLoop);
}

// Utilitaires
function rectIntersect(x1, y1, w1, h1, x2, y2, w2, h2) {
    return x2 < x1 + w1 && x2 + w2 > x1 && y2 < y1 + h1 && y2 + h2 > y1;
}

function checkHazardCollision() {
    for (let h of hazards) {
        if (rectIntersect(player.x, player.y, player.w, player.h, h.x, h.y, h.w, h.h)) return true;
    }
    return false;
}

// ==========================================
// 5. LOGIQUE DU JEU (Morts, Victoire, Sauvegarde)
// ==========================================
function die() {
    gameState.deaths++;
    // On ne sauvegarde pas à chaque mort pour économiser Firebase
    // On sauvegarde toutes les 10 morts localement dans l'interface
    updateHUD();
    
    // Respawn (recharge le niveau actuel)
    generateLevel(gameState.level);
    
    // Sauvegarde auto "paresseuse" (toutes les 10 morts)
    if (gameState.deaths % 10 === 0) {
        saveProgress();
    }
}

function winLevel() {
    // Gain d'argent (seulement si première fois)
    if (!gameState.levelsCompleted.includes(gameState.level)) {
        gameState.kevCoins += 100;
        gameState.levelsCompleted.push(gameState.level);
    }
    
    gameState.level++;
    saveProgress(); // Sauvegarde importante ici
    generateLevel(gameState.level);
}

// ==========================================
// 6. FIREBASE & SAUVEGARDE
// ==========================================
// Créer ou charger le profil utilisateur
async function initUserProfile() {
    let userId = localStorage.getItem('kevinGameId');
    if (!userId) {
        userId = "user_" + Date.now();
        localStorage.setItem('kevinGameId', userId);
    }

    const userRef = doc(db, "players", userId);
    const docSnap = await getDoc(userRef);

    if (docSnap.exists()) {
        const data = docSnap.data();
        gameState.level = data.level;
        gameState.deaths = data.deaths;
        gameState.kevCoins = data.kevCoins;
        gameState.playerName = data.name;
        gameState.levelsCompleted = data.levelsCompleted || [];
        player.color = data.skin || '#8A2BE2';
        console.log("Profil chargé !");
    } else {
        // Création nouveau profil
        await setDoc(userRef, {
            name: gameState.playerName,
            level: 1,
            deaths: 0,
            kevCoins: 0,
            levelsCompleted: [],
            skin: player.color
        });
        console.log("Nouveau profil créé !");
    }
    
    updateHUD();
    loadLeaderboard();
}

async function saveProgress() {
    let userId = localStorage.getItem('kevinGameId');
    if (!userId) return;

    const userRef = doc(db, "players", userId);
    await updateDoc(userRef, {
        level: gameState.level,
        deaths: gameState.deaths,
        kevCoins: gameState.kevCoins,
        levelsCompleted: gameState.levelsCompleted,
        skin: player.color
    });
    console.log("Sauvegarde effectuée.");
}

// Charger le classement
function loadLeaderboard() {
    const q = query(collection(db, "players"), orderBy("level", "desc"), limit(5));
    
    // Écoute en temps réel
    onSnapshot(q, (snapshot) => {
        const list = document.getElementById('leaderboard-list');
        list.innerHTML = "";
        snapshot.forEach((doc) => {
            const p = doc.data();
            const li = document.createElement('li');
            li.textContent = `${p.name}: Niv ${p.level}`;
            list.appendChild(li);
        });
    });

    // Classement des morts (Juste pour l'exemple)
    const qDeaths = query(collection(db, "players"), orderBy("deaths", "desc"), limit(5));
    onSnapshot(qDeaths, (snapshot) => {
        const list = document.getElementById('death-leaderboard-list');
        list.innerHTML = "";
        snapshot.forEach((doc) => {
            const p = doc.data();
            const li = document.createElement('li');
            li.textContent = `${p.name}: ${p.deaths} morts`;
            list.appendChild(li);
        });
    });
}

// ==========================================
// 7. INPUTS & UI
// ==========================================
function updateHUD() {
    document.getElementById('player-name-display').innerText = gameState.playerName;
    document.getElementById('player-level-display').innerText = "Niv Joueur: " + gameState.level;
    document.getElementById('coin-display').innerText = gameState.kevCoins;
    document.getElementById('level-select-input').value = gameState.level;
}

window.addEventListener('keydown', (e) => {
    if (e.code === 'ArrowRight') keys.right = true;
    if (e.code === 'ArrowLeft') keys.left = true;
    if (e.code === 'ArrowUp' || e.code === 'Space') {
        // Saut normal
        if (player.onGround) {
            player.vy = PHYS.jump;
        } 
        // Saut mural (Wall Jump)
        else if (player.wallSliding) {
            player.vy = PHYS.wallJumpY;
            player.vx = -player.wallDir * PHYS.wallJumpX; // Rebondit opposé au mur
        }
    }
});

window.addEventListener('keyup', (e) => {
    if (e.code === 'ArrowRight') keys.right = false;
    if (e.code === 'ArrowLeft') keys.left = false;
});

// Boutons UI
document.getElementById('btn-start').addEventListener('click', () => {
    document.getElementById('game-overlay').style.display = 'none';
    gameState.isPaused = false;
    // Lance la musique ici si besoin
});

document.getElementById('btn-restart-level').addEventListener('click', () => {
    die(); // Simule une mort pour reset
});

document.getElementById('level-select-input').addEventListener('change', (e) => {
    // Cheat pour debug : changer de niveau manuellement
    let val = parseInt(e.target.value);
    if(val > 0) {
        gameState.level = val;
        generateLevel(val);
    }
});

document.getElementById('btn-shop').addEventListener('click', () => {
    if(gameState.kevCoins >= 500) {
        let colors = ['orange', 'yellow', 'cyan', 'pink'];
        player.color = colors[Math.floor(Math.random() * colors.length)];
        gameState.kevCoins -= 500;
        alert("Nouvelle couleur aléatoire achetée ! (-500 KC)");
        saveProgress();
        updateHUD();
    } else {
        alert("Pas assez de KevCoins ! Il faut 500 KC.");
    }
});

// Lancement
initUserProfile();
generateLevel(1);
gameLoop();
// Affiche le menu de départ
document.getElementById('game-overlay').style.display = 'block';
