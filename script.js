let currentVersion = "DUO v0.3";

document.getElementById("version-text").textContent = currentVersion;

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";
import {
    getDatabase,
    ref,
    set,
    update,
    onValue,
    get,
    onDisconnect,
    runTransaction
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-database.js";

import {
    getAuth,
    signInAnonymously
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";

// Les deux moteurs de règles : le mode de la salle décide lequel est utilisé
import * as duoRules from "./game/duo.js";
import * as noMercyRules from "./game/duo-no-mercy.js";

let playerId = null;
let currentRoomCode = null;
let currentGame = null;
let currentGameMode = "duo"; // "duo" ou "duo-no-mercy" (synchronisé depuis la salle)
let hasDrawnThisTurn = false;
let pendingWildCard = null;
let finishOrder = [];
let hasCalledUno = false;
let drawnCardId = null;
let lastDuoAnnouncementTimestamp = null;
let lastCardPlayedTimestamp = null;
let lastEventTimestamp = null;
let roomSnapshotReceived = false;
let victorySoundPlayed = false;
let roomPlayers = {};
let unsubscribeRoom = null;
let unsubscribeHand = null;

const savedPlayerName = localStorage.getItem("duo-player-name");
if (savedPlayerName) {
    const nameInput = document.getElementById("player-name");
    if (nameInput) nameInput.value = savedPlayerName;
}

// Configuration Firebase
const firebaseConfig = {
    apiKey: "AIzaSyBVAVM6eWNchGA0P0EykEuxvCc-ECYpg_Q",
    authDomain: "duo-game-6ba36.firebaseapp.com",
    databaseURL: "https://duo-game-6ba36-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "duo-game-6ba36",
    storageBucket: "duo-game-6ba36.firebasestorage.app",
    messagingSenderId: "582987380607",
    appId: "1:582987380607:web:3540234d3516c92d22cc4a",
    measurementId: "G-DSTRBBMDVE"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

console.log("Firebase connecté !");

// ===========================================================================
// MODES DE JEU
// ===========================================================================

function isNoMercy() {
    return currentGameMode === "duo-no-mercy";
}

function getRules() {
    return isNoMercy() ? noMercyRules : duoRules;
}

// Met à jour le logo et le titre selon le mode
function applyModeUI() {
    const logo = document.getElementById("current-game-mode-logo");
    if (logo) {
        logo.src = isNoMercy() ? "images/duo-no-mercy.webp" : "images/duo-logo.webp";
        logo.alt = isNoMercy() ? "DUO NO MERCY" : "DUO";
    }

    const title = document.getElementById("lobby-title");
    if (title) title.textContent = isNoMercy() ? "Salon NO MERCY" : "Salon de jeu";
}

// Ordre des places : stable en No Mercy (game.order), sinon les joueurs ayant une main
function getPlayerIds() {
    if (!currentGame) return [];
    if (isNoMercy() && currentGame.order) return currentGame.order;
    return Object.keys(currentGame.hands || {});
}

// Joueurs encore en lice (ni terminés, ni éliminés)
function getRemainingPlayers(playerIds) {
    if (isNoMercy()) {
        return noMercyRules.getActivePlayers(currentGame, playerIds, finishOrder);
    }
    return playerIds.filter(id => !finishOrder.includes(id));
}

function getFinalRanking(playerIds) {
    if (isNoMercy()) {
        return noMercyRules.getRanking(currentGame, playerIds, finishOrder);
    }
    return [...finishOrder, ...getRemainingPlayers(playerIds)];
}

function isEliminated() {
    return !!currentGame?.eliminated?.includes(playerId);
}

function isMyTurnNow() {
    return !!currentGame && getRules().isMyTurn(currentGame, playerId);
}

function getPlayerName(id) {
    return roomPlayers?.[id]?.name || "Joueur";
}

// ===========================================================================
// SAUVEGARDE FIREBASE
// ===========================================================================

// Champs de currentGame qui ne doivent pas être réécrits dans game/ :
// les mains ont leur propre nœud, et les deux autres sont écrits par les joueurs.
const NOT_SHARED_KEYS = ["hands", "cardPlayed", "duoAnnouncement"];

function getSharedGame() {
    const shared = {};
    for (const [key, value] of Object.entries(currentGame)) {
        if (NOT_SHARED_KEYS.includes(key)) continue;
        shared[key] = value;
    }
    // Retire les undefined (Firebase les refuse)
    return JSON.parse(JSON.stringify(shared));
}

// Sauvegarde l'état complet (stackCount, eliminated, order... inclus)
// en mettant à jour chaque champ séparément pour ne pas écraser cardPlayed / duoAnnouncement.
async function saveGame(extra = {}) {
    if (!currentRoomCode || !currentGame) return;

    const updates = { hands: currentGame.hands, ...extra };
    const shared = getSharedGame();

    for (const key of Object.keys(shared)) {
        updates[`game/${key}`] = shared[key];
    }

    await update(ref(db, `rooms/${currentRoomCode}`), updates);
}

// ===========================================================================
// CONNEXION / SALONS
// ===========================================================================

document.getElementById("start-game")?.addEventListener("click", startGame);
document.getElementById("restart-game")?.addEventListener("click", startGame);

signInAnonymously(auth)
    .then(async userCredential => {
        playerId = userCredential.user.uid;
        const savedName = localStorage.getItem("duo-player-name") || "Joueur";

        const profileElem = document.getElementById("player-profile-username");
        if (profileElem) profileElem.textContent = savedName;

        const savedDuoId = localStorage.getItem("duo-player-id");
        if (savedDuoId) {
            const duoIdElem = document.getElementById("player-duo-id");
            if (duoIdElem) duoIdElem.textContent = `ID : ${savedDuoId}`;
        }

        await loadFriends();
        await loadFriendRequests();

        await update(ref(db, `users/${playerId}`), { username: savedName });
        document.getElementById("status").textContent = "Connecté à Firebase";
    })
    .catch((error) => {
        console.error("Erreur de connexion :", error);
        document.getElementById("status").textContent = "Erreur de connexion";
    });

function generateRoomCode() {
    const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let code = "";
    for (let i = 0; i < 6; i++) {
        code += characters[Math.floor(Math.random() * characters.length)];
    }
    return code;
}

function getOrCreateDuoId() {
    let duoId = localStorage.getItem("duo-player-id");
    if (!duoId) {
        const characters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        let code = "";
        for (let i = 0; i < 5; i++) {
            code += characters[Math.floor(Math.random() * characters.length)];
        }
        duoId = `DUO-${code}`;
        localStorage.setItem("duo-player-id", duoId);
    }
    return duoId;
}

async function createRoom() {
    if (!playerId) {
        alert("Connexion à Firebase en cours...");
        return;
    }

    const playerName = document.getElementById("player-name").value.trim();

    if (!playerName) {
        document.getElementById("player-name-message").textContent = "Entre ton pseudo pour continuer.";
        return;
    }

    localStorage.setItem("duo-player-name", playerName);
    const duoId = getOrCreateDuoId();

    await update(ref(db, `users/${playerId}`), { username: playerName, duoId: duoId });
    await set(ref(db, `duoIds/${duoId}`), playerId);

    document.getElementById("player-name-message").textContent = "";
    const roomCode = generateRoomCode();
    const roomRef = ref(db, `rooms/${roomCode}`);

    await set(roomRef, {
        status: "waiting",
        mode: currentGameMode, // tous les joueurs de la salle utiliseront ce mode
        hostId: playerId,
        createdAt: Date.now(),
        players: {
            [playerId]: { name: playerName, joinedAt: Date.now() }
        }
    });

    const playerRef = ref(db, `rooms/${roomCode}/players/${playerId}`);
    onDisconnect(playerRef).remove();

    currentRoomCode = roomCode;
    roomSnapshotReceived = false;
    document.getElementById("connection-screen").style.display = "none";
    document.getElementById("game-interface").style.display = "block";
    document.getElementById("room-info").textContent = `Salon : ${roomCode}`;
    applyModeUI();

    listenToRoom();
}

async function joinRoom() {
    if (!playerId) {
        alert("Connexion à Firebase en cours...");
        return;
    }

    const playerName = document.getElementById("player-name").value.trim();
    const roomCode = document.getElementById("room-code").value.trim().toUpperCase();

    if (!playerName) {
        document.getElementById("player-name-message").textContent = "Entre ton pseudo pour continuer.";
        return;
    }

    if (!roomCode) {
        document.getElementById("room-code-message").textContent = "Entre le code du salon pour continuer.";
        return;
    }

    // On ne lit QUE le champ "mode" (les règles Firebase interdisent de lire
    // tout le salon avant d'en être membre). Il sert aussi à vérifier que le
    // salon existe, sinon on créerait un salon fantôme.
    let roomMode = null;
    try {
        const modeSnapshot = await get(ref(db, `rooms/${roomCode}/mode`));
        roomMode = modeSnapshot.exists() ? modeSnapshot.val() : null;
    } catch (error) {
        console.error("Impossible de lire le mode du salon :", error);
    }

    if (!roomMode) {
        document.getElementById("room-code-message").textContent = "Salon introuvable.";
        return;
    }
    document.getElementById("room-code-message").textContent = "";

    // Le mode est celui du salon, peu importe celui choisi sur l'écran
    currentGameMode = roomMode;

    const playerRef = ref(db, `rooms/${roomCode}/players/${playerId}`);
    await set(playerRef, { name: playerName, joinedAt: Date.now() });
    onDisconnect(playerRef).remove();

    currentRoomCode = roomCode;
    roomSnapshotReceived = false;
    document.getElementById("connection-screen").style.display = "none";
    document.getElementById("game-interface").style.display = "block";
    document.getElementById("room-info").textContent = `Salon : ${roomCode}`;
    applyModeUI();

    listenToRoom();
}

function checkMissedUno() {
    if (!currentGame) return [];
    const missedPlayers = [];
    const required = currentGame.unoRequired || {};
    const called = currentGame.unoCalled || {};

    for (const pId in required) {
        if (required[pId] === true && called[pId] !== true) {
            missedPlayers.push(pId);
        }
    }
    return missedPlayers;
}

function applyUnoPenalty(targetPlayerId) {
    if (!currentGame) return;
    const hand = currentGame.hands[targetPlayerId];
    if (!hand) return;

    for (let i = 0; i < 2; i++) {
        if (currentGame.deck.length === 0) break;
        hand.push(currentGame.deck.pop());
    }
}

// ===========================================================================
// ÉCOUTE DE LA SALLE
// ===========================================================================

function listenToRoom() {
    if (!currentRoomCode) return;
    if (unsubscribeRoom) unsubscribeRoom();

    const roomRef = ref(db, `rooms/${currentRoomCode}`);

    unsubscribeRoom = onValue(roomRef, async (snapshot) => {
        const room = snapshot.val();
        const statusElement = document.getElementById("status");

        if (!room) return;

        const isFirstSnapshot = !roomSnapshotReceived;
        roomSnapshotReceived = true;

        roomPlayers = room.players || {};

        // Le mode vient de la salle
        if (room.mode && room.mode !== currentGameMode) {
            currentGameMode = room.mode;
            applyModeUI();
        }

        if (room.status === "waiting") statusElement.textContent = "🟢 En attente de joueurs...";
        if (room.status === "playing") statusElement.textContent = "🎮 Partie en cours !";
        if (room.status === "finished") statusElement.textContent = "🏆 Partie terminée !";

        finishOrder = room.finishOrder || [];

        if (room.status === "finished") {
            displayFinalRanking(room);
        }

        const playerIds = Object.keys(room.players || {});
        if (room.hostId && !room.players?.[room.hostId] && playerIds.length > 0) {
            await update(roomRef, { hostId: playerIds[0] });
            return;
        }

        displayPlayers(room.players, room.hostId);
        updateHostUI(room.hostId);
        updateGameInterface(room.status);
        listenToMyHand();

        if (room.game) {
            const duoAnnouncement = room.game.duoAnnouncement;
            const cardPlayed = room.game.cardPlayed;
            const lastEvent = room.game.lastEvent;

            if (cardPlayed && cardPlayed.timestamp !== lastCardPlayedTimestamp) {
                lastCardPlayedTimestamp = cardPlayed.timestamp;
                if (cardPlayed.playerId !== playerId) playCardSound();
            }

            if (duoAnnouncement && duoAnnouncement.timestamp !== lastDuoAnnouncementTimestamp) {
                lastDuoAnnouncementTimestamp = duoAnnouncement.timestamp;
                const duoElement = document.getElementById("duo-announcement");
                const duoPlayerName = document.getElementById("duo-player-name");

                if (duoElement) {
                    if (duoPlayerName) duoPlayerName.textContent = duoAnnouncement.playerName;
                    duoElement.classList.remove("show");
                    void duoElement.offsetWidth;
                    duoElement.classList.add("show");
                    playDuoSound();
                }
            }

            // Messages d'événements (No Mercy) : on ignore ceux d'avant notre arrivée
            if (lastEvent && lastEvent.timestamp !== lastEventTimestamp) {
                lastEventTimestamp = lastEvent.timestamp;
                if (!isFirstSnapshot) {
                    const message = describeGameEvent(lastEvent, room.game);
                    if (message) showToast(message);
                }
            }

            currentGame = {
                ...room.game,
                hands: room.hands || {},
                deck: room.game.deck || [],
                discardPile: room.game.discardPile || [],
                eliminated: room.game.eliminated || [],
                stackCount: room.game.stackCount || 0,
                unoCalled: room.game.unoCalled || {},
                unoRequired: room.game.unoRequired || {}
            };

            // Sécurité : si ce n'est pas mon tour, je n'ai pas pioché
            if (currentGame.currentPlayer !== playerId) hasDrawnThisTurn = false;

            if (currentGame.hands[playerId]) {
                displayMyHand(currentGame.hands[playerId]);
            }

            // DUO obligatoire dès qu'un joueur n'a plus qu'une carte
            for (const id of Object.keys(currentGame.hands)) {
                if (currentGame.hands[id]?.length === 1 && currentGame.unoRequired[id] !== true) {
                    currentGame.unoRequired[id] = true;
                    await set(ref(db, `rooms/${currentRoomCode}/game/unoRequired/${id}`), true);
                }
            }

            // Joueurs partis en cours de partie
            const currentPlayerIds = Object.keys(room.players || {});
            const gamePlayerIds = Object.keys(currentGame.hands || {});
            const leftPlayers = gamePlayerIds.filter(id => !currentPlayerIds.includes(id));

            if (leftPlayers.length > 0) {
                for (const leftPlayerId of leftPlayers) {
                    delete currentGame.hands[leftPlayerId];
                    delete currentGame.unoCalled[leftPlayerId];
                    delete currentGame.unoRequired[leftPlayerId];
                }

                const remainingPlayerIds = Object.keys(currentGame.hands);

                // Si le joueur qui devait choisir la couleur est parti, la roulette est annulée
                const rouletteCancelled = !!currentGame.pendingRoulette
                    && leftPlayers.includes(currentGame.pendingRoulette.playerId);
                if (rouletteCancelled) currentGame.pendingRoulette = null;

                // Seul l'hôte écrit, pour éviter que tous les clients écrivent en même temps
                if (room.hostId === playerId) {
                    if (remainingPlayerIds.length === 1) {
                        const ranking = [
                            ...finishOrder,
                            ...remainingPlayerIds.filter(id => !finishOrder.includes(id))
                        ];
                        await update(roomRef, {
                            status: "finished",
                            finishOrder: ranking,
                            hands: currentGame.hands,
                            "game/currentPlayer": remainingPlayerIds[0],
                            "game/unoCalled": currentGame.unoCalled,
                            "game/unoRequired": currentGame.unoRequired
                        });
                        return;
                    }

                    if (leftPlayers.includes(currentGame.currentPlayer) && remainingPlayerIds.length > 1) {
                        getRules().nextPlayer(currentGame, remainingPlayerIds, finishOrder);
                    }

                    await update(roomRef, {
                        hands: currentGame.hands,
                        "game/currentPlayer": currentGame.currentPlayer,
                        "game/pendingRoulette": currentGame.pendingRoulette || null,
                        "game/unoCalled": currentGame.unoCalled,
                        "game/unoRequired": currentGame.unoRequired
                    });
                }
            }

            displayTurnInfo();
            updateGameButtons();
            updatePlayableCards();
            updateUnoButton();
            displayPlayers(room.players, room.hostId);
            updateBackgroundColor();
            checkPendingRoulette();
        }

        if (room.game?.discardPile) {
            displayDiscardCard(room.game.discardPile[room.game.discardPile.length - 1]);
        }
    });
}

// ===========================================================================
// AFFICHAGE : JOUEURS, CLASSEMENT, MESSAGES
// ===========================================================================

function displayPlayers(players, hostId) {
    const list = document.getElementById("players-list");
    if (!list) return;
    list.innerHTML = "";

    if (!players) return;

    Object.entries(players).forEach(([id, player]) => {
        const li = document.createElement("li");
        if (currentGame && currentGame.currentPlayer === id) {
            li.classList.add("current-player");
        }

        let prefix = id === hostId ? "👑 " : "";
        if (currentGame && currentGame.currentPlayer === id) prefix += "🟢 ";

        let status = "";
        const hand = currentGame?.hands?.[id];

        if (currentGame?.eliminated?.includes(id)) {
            status = " — 💀 éliminé";
        } else if (hand) {
            status = ` — ${hand.length} carte(s)`;
            // Avertissement quand on approche de la limite de la pitié
            if (isNoMercy() && hand.length >= noMercyRules.RULES.mercyLimit - 5) status += " ⚠️";
        } else if (currentGame && finishOrder.includes(id)) {
            status = " — ✅ terminé";
        }

        li.textContent = `${prefix}${player.name}${status}`;
        list.appendChild(li);
    });
}

function displayFinalRanking(room) {
    const winnerMessage = document.getElementById("winner-message");
    const finalRanking = document.getElementById("final-ranking");
    if (!winnerMessage || !finalRanking) return;

    const ranking = room.finishOrder || [];
    if (ranking.length === 0) {
        winnerMessage.style.display = "none";
        return;
    }

    if (!victorySoundPlayed) {
        playVictorySound();
        victorySoundPlayed = true;
    }

    const players = room.players || {};
    const eliminated = room.game?.eliminated || [];
    let html = "<h2>🏆 Classement final</h2>";

    ranking.forEach((pId, index) => {
        const player = players[pId];
        if (!player) return;
        let medal = index === 0 ? "🥇" : index === 1 ? "🥈" : index === 2 ? "🥉" : `${index + 1}.`;
        const skull = eliminated.includes(pId) ? " 💀" : "";
        html += `<p>${medal} ${player.name}${skull}</p>`;
    });

    finalRanking.innerHTML = html;
    const restartButton = document.getElementById("restart-game");
    if (restartButton) {
        restartButton.style.display = room.hostId === playerId ? "block" : "none";
    }

    winnerMessage.style.display = "flex";
}

// Petit message temporaire en haut de l'écran
let toastTimeout = null;

function showToast(message) {
    let toast = document.getElementById("game-toast");

    if (!toast) {
        toast = document.createElement("div");
        toast.id = "game-toast";
        Object.assign(toast.style, {
            position: "fixed",
            top: "20px",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: "3000",
            padding: "12px 22px",
            borderRadius: "14px",
            background: "rgba(0, 0, 0, 0.8)",
            color: "#fff",
            fontSize: "16px",
            fontWeight: "600",
            textAlign: "center",
            maxWidth: "90vw",
            pointerEvents: "none",
            opacity: "0",
            transition: "opacity 0.25s"
        });
        document.body.appendChild(toast);
    }

    toast.textContent = message;
    toast.style.opacity = "1";

    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => { toast.style.opacity = "0"; }, 3000);
}

function describeGameEvent(event, game) {
    const name = getPlayerName(event.playerId);
    const target = event.targetPlayerId ? getPlayerName(event.targetPlayerId) : "";

    switch (event.type) {
        case "draw":
            return event.count > 1 ? `📥 ${name} pioche ${event.count} cartes` : null;
        case "eliminated":
            return `💀 ${name} est éliminé !`;
        case "skip_all":
            return `⏭️ ${name} passe tout le monde`;
        case "discard_all":
            return `🗑️ ${name} défausse ${event.discarded || 0} carte(s)`;
        case "roulette":
            return `🎰 ${name} joue la Roulette ! ${target} doit choisir une couleur`;
        case "roulette_result":
            if (game?.eliminated?.includes(event.playerId)) {
                return `🎰 ${name} pioche ${event.count || 0} cartes et est éliminé !`;
            }
            return `🎰 ${name} pioche ${event.count || 0} carte(s) pour trouver la couleur`;
        case "number":
            if (event.targetPlayerId) return `🔀 ${name} échange sa main avec ${target}`;
            if (event.value === 0 && event.rotated) return "🔄 Toutes les mains tournent !";
            return null;
        case "draw2":
        case "draw4_color":
        case "draw4":
        case "draw6":
        case "draw10":
            return `💥 ${name} attaque ! Cumul : +${game?.stackCount || 0}`;
        default:
            return null;
    }
}

function updateHostUI(hostId) {
    const button = document.getElementById("start-game");
    if (!button) return;

    if (currentGame && currentGame.currentPlayer) {
        button.style.display = "none";
        return;
    }

    button.style.display = hostId === playerId ? "block" : "none";
}

// ===========================================================================
// DÉMARRAGE DE PARTIE
// ===========================================================================

async function startGame() {
    victorySoundPlayed = false;
    if (!currentRoomCode || !playerId) return;

    const roomRef = ref(db, `rooms/${currentRoomCode}`);
    const snapshot = await get(roomRef);
    const room = snapshot.val();

    if (!room || room.hostId !== playerId) return;

    if (room.mode) currentGameMode = room.mode;

    const playerIds = Object.keys(room.players || {});
    const game = getRules().createGameState(playerIds);
    finishOrder = [];
    hasDrawnThisTurn = false;

    currentGame = {
        ...game,
        unoCalled: game.unoCalled || {},
        unoRequired: game.unoRequired || {}
    };

    // Ici on remplace tout le nœud game (nouvelle partie, on efface cardPlayed, etc.)
    await update(roomRef, {
        status: "playing",
        finishOrder: [],
        game: getSharedGame(),
        hands: game.hands
    });

    displayMyHand(game.hands[playerId]);
    displayDiscardCard(game.discardPile[game.discardPile.length - 1]);
    displayTurnInfo();
    updateGameButtons();
    updatePlayableCards();
    updateUnoButton();
    updateBackgroundColor();
}

// ===========================================================================
// MA MAIN & JOUER UNE CARTE
// ===========================================================================

// Cette carte est-elle jouable maintenant (couleur, valeur, cumul d'attaque...) ?
function canPlayerPlay(card) {
    if (!currentGame?.discardPile?.length) return false;

    const hand = currentGame.hands?.[playerId];
    if (!hand) return false;

    // Une roulette attend sa couleur : on ne peut rien jouer
    if (currentGame.pendingRoulette) return false;

    const topCard = currentGame.discardPile[currentGame.discardPile.length - 1];

    return getRules().canPlayCard(
        card,
        topCard,
        currentGame.currentColor,
        hand,
        currentGame.stackCount || 0
    );
}

function cardNeedsColor(card) {
    if (isNoMercy()) return noMercyRules.needsColorChoice(card);
    return card.type === "wild" || card.type === "draw4";
}

function cardNeedsTarget(card) {
    if (!isNoMercy()) return false;
    return noMercyRules.needsTargetChoice(currentGame, playerId, card, getPlayerIds(), finishOrder);
}

function cardNeedsRotate(card) {
    if (!isNoMercy()) return false;
    return noMercyRules.needsRotateChoice(currentGame, playerId, card, getPlayerIds(), finishOrder);
}

function displayMyHand(hand) {
    const container = document.getElementById("my-hand");
    const title = document.getElementById("my-hand-title");
    if (!container) return;

    container.innerHTML = "";

    if (!hand) {
        if (title) title.textContent = "Ma main";
        return;
    }

    if (title) {
        title.textContent = `Ma main — ${hand.length} carte${hand.length > 1 ? "s" : ""}`;
    }

    hand.forEach(card => {
        const imagePath = getCardImage(card);
        const cardElement = document.createElement("img");
        cardElement.src = imagePath;
        cardElement.alt = "Carte UNO";
        cardElement.className = "card-image";
        cardElement.dataset.cardId = card.id;

        if (card.id === drawnCardId) {
            cardElement.classList.add("drawn-card-animation");
            drawnCardId = null;
        }

        cardElement.addEventListener("click", () => handleCardClick(card));

        container.appendChild(cardElement);
    });

    updatePlayableCards();
}

// Clic sur une carte : on demande d'abord les choix nécessaires (couleur / cible)
async function handleCardClick(card) {
    if (!currentGame || !isMyTurnNow() || isEliminated()) return;
    if (!canPlayerPlay(card)) return;

    if (cardNeedsColor(card)) {
        pendingWildCard = card;
        showColorChoice();
        return;
    }

    if (cardNeedsTarget(card)) {
        showTargetChoice(card);
        return;
    }

    if (cardNeedsRotate(card)) {
        showRotateChoice(card);
        return;
    }

    await playSelectedCard(card, {});
}

// Joue réellement la carte, met à jour l'affichage et sauvegarde
// options.color : couleur choisie / options.targetPlayerId : joueur ciblé (7)
async function playSelectedCard(card, options = {}) {
    const rules = getRules();
    const playerIds = getPlayerIds();

    const success = rules.playCard(currentGame, playerId, card.id, playerIds, finishOrder, options);
    if (!success) return false;

    // DUO classique : le +4 et la couleur choisie sont gérés ici
    if (!isNoMercy()) {
        if (card.type === "draw4") {
            const nextPlayerId = currentGame.currentPlayer;
            for (let i = 0; i < 4; i++) {
                if (currentGame.deck.length === 0) duoRules.recycleDiscardPile(currentGame);
                if (currentGame.deck.length === 0) break;
                currentGame.hands[nextPlayerId].push(currentGame.deck.pop());
            }
            duoRules.nextPlayer(currentGame, playerIds, finishOrder);
        }

        if (options.color) currentGame.currentColor = options.color;
    }

    playCardSound();
    hasDrawnThisTurn = false;

    // Un joueur a-t-il fini ? La partie est-elle terminée ?
    const extra = updateFinishOrder();

    displayMyHand(currentGame.hands[playerId]);
    displayDiscardCard(currentGame.discardPile[currentGame.discardPile.length - 1]);
    displayTurnInfo();
    updateGameButtons();
    updateUnoButton();
    updateBackgroundColor();

    await saveGame(extra);

    await set(ref(db, `rooms/${currentRoomCode}/game/cardPlayed`), {
        playerId: playerId,
        timestamp: Date.now()
    });

    return true;
}

// Met à jour finishOrder et retourne ce qu'il faut sauvegarder en plus de la partie
function updateFinishOrder() {
    for (const id of Object.keys(currentGame.hands)) {
        if (currentGame.hands[id]?.length === 0 && !finishOrder.includes(id)) {
            finishOrder.push(id);
        }
    }

    const playerIds = getPlayerIds();
    const remaining = getRemainingPlayers(playerIds);
    const extra = { finishOrder: finishOrder };

    if (remaining.length <= 1) {
        finishOrder = getFinalRanking(playerIds);
        extra.finishOrder = finishOrder;
        extra.status = "finished";
    }

    return extra;
}

function updatePlayableCards() {
    const cards = document.querySelectorAll("#my-hand .card-image");
    if (!currentGame || !currentGame.discardPile) return;

    const myHand = currentGame.hands?.[playerId] || [];
    const myTurn = isMyTurnNow() && !isEliminated();

    cards.forEach(cardElement => {
        const card = myHand.find(c => c.id === cardElement.dataset.cardId);

        cardElement.classList.remove("playable-card");
        cardElement.onmouseenter = null;

        if (!card || !myTurn) return;

        if (canPlayerPlay(card)) {
            cardElement.classList.add("playable-card");
            cardElement.onmouseenter = playCardHoverSound;
        }
    });
}

function listenToMyHand() {
    if (!currentRoomCode || !playerId || unsubscribeHand) return;

    const handRef = ref(db, `rooms/${currentRoomCode}/hands/${playerId}`);
    unsubscribeHand = onValue(handRef, (snapshot) => {
        displayMyHand(snapshot.val());
    });
}

function getCardImage(card) {
    if (isNoMercy()) {
        const imageName = noMercyRules.getCardImageName(card);
        return imageName ? `images/duo-no-mercy/${imageName}.webp` : null;
    }

    const imageFolder = "images/duo/";

    if (card.type === "number") return `${imageFolder}${card.color}-${card.value}.webp`;
    if (card.type === "skip") return `${imageFolder}${card.color}-skip.webp`;
    if (card.type === "reverse") return `${imageFolder}${card.color}-reverse.webp`;
    if (card.type === "draw2") return `${imageFolder}${card.color}-draw2.webp`;
    if (card.type === "wild") return `${imageFolder}wild.webp`;
    if (card.type === "draw4") return `${imageFolder}draw4.webp`;

    return null;
}

function displayDiscardCard(card) {
    const container = document.getElementById("discard-pile");
    if (!container) return;
    container.innerHTML = "";
    if (!card) return;

    const imagePath = getCardImage(card);
    const cardElement = document.createElement("img");
    cardElement.src = imagePath;
    cardElement.alt = "Carte sur la table";
    cardElement.className = "card-image discard-card-animation";
    container.appendChild(cardElement);
}

function updateBackgroundColor() {
    let startColor = "#6a5acd";
    let endColor = "#00bcd4";

    if (currentGame?.currentColor === "red") { startColor = "#b71c1c"; endColor = "#ef5350"; }
    if (currentGame?.currentColor === "blue") { startColor = "#0a4cda"; endColor = "#2958f1"; }
    if (currentGame?.currentColor === "green") { startColor = "#209425"; endColor = "#57dd5e"; }
    if (currentGame?.currentColor === "yellow") { startColor = "#b48305"; endColor = "#e0b423"; }

    document.body.style.setProperty("--game-start", startColor);
    document.body.style.setProperty("--game-end", endColor);
}

// ===========================================================================
// PIOCHER / PASSER / DUO
// ===========================================================================

document.getElementById("draw-card")?.addEventListener("click", async () => {
    if (!currentGame || !isMyTurnNow() || hasDrawnThisTurn || isEliminated()) return;
    if (currentGame.pendingRoulette) return;

    const rules = getRules();
    const playerIds = getPlayerIds();
    const hadAttackStack = (currentGame.stackCount || 0) > 0;

    const result = rules.drawCard(currentGame, playerId, hasDrawnThisTurn, playerIds, finishOrder);
    if (!result) return;

    // DUO classique : drawCard renvoie la carte piochée
    // No Mercy : drawCard renvoie { drawn, endsTurn, eliminated, canPlay }
    let drawnCards;
    let turnIsOver = false;
    let eliminated = false;

    if (isNoMercy()) {
        drawnCards = result.drawn;
        eliminated = result.eliminated;
        turnIsOver = result.endsTurn || result.eliminated;
    } else {
        drawnCards = [result];
    }

    if (drawnCards.length > 0) {
        drawnCardId = drawnCards[drawnCards.length - 1].id;
    }

    // Si le tour est déjà passé (attaque encaissée, élimination, rien à jouer), pas de bouton "Passer"
    hasDrawnThisTurn = !turnIsOver;

    // No Mercy : 1 carte piochée, et rien de jouable -> le tour est passé automatiquement
    if (isNoMercy() && turnIsOver && !hadAttackStack && !eliminated) {
        showToast("😕 Aucune carte jouable : ton tour est passé");
    }

    // Une élimination peut terminer la partie
    const extra = eliminated ? updateFinishOrder() : {};

    displayMyHand(currentGame.hands[playerId]);
    displayTurnInfo();
    updateGameButtons();
    updateUnoButton();

    await saveGame(extra);

    playDrawSound();
});

document.getElementById("pass-turn")?.addEventListener("click", async () => {
    if (!currentGame || !isMyTurnNow() || !hasDrawnThisTurn) return;

    const playerIds = getPlayerIds();
    hasDrawnThisTurn = false;

    getRules().nextPlayer(currentGame, playerIds, finishOrder);

    displayTurnInfo();
    updateGameButtons();

    await saveGame();
});

document.getElementById("uno-button")?.addEventListener("click", async () => {
    hasCalledUno = true;
    const duoAnnouncement = document.getElementById("duo-announcement");
    const duoPlayerName = document.getElementById("duo-player-name");

    if (duoAnnouncement) {
        if (duoPlayerName) {
            const playerName = document.getElementById("player-name").value.trim();
            duoPlayerName.textContent = playerName || "Joueur";
        }
        duoAnnouncement.classList.remove("show");
        void duoAnnouncement.offsetWidth;
        duoAnnouncement.classList.add("show");
    }

    document.getElementById("uno-button").style.display = "none";
    await set(ref(db, `rooms/${currentRoomCode}/game/unoCalled/${playerId}`), true);
    playDuoSound();

    await set(ref(db, `rooms/${currentRoomCode}/game/duoAnnouncement`), {
        playerId: playerId,
        playerName: document.getElementById("player-name").value.trim() || "Joueur",
        timestamp: Date.now()
    });
});

function displayTurnInfo() {
    const element = document.getElementById("turn-info");
    if (!element) return;

    if (!currentGame) {
        element.textContent = "";
        element.className = "";
        return;
    }

    const stack = currentGame.stackCount || 0;

    if (isEliminated()) {
        element.textContent = "💀 Tu as été éliminé... Tu regardes la fin de la partie.";
        element.className = "other-turn";
        return;
    }

    const roulettePending = isNoMercy() && !!currentGame.pendingRoulette
        && currentGame.pendingRoulette.playerId === currentGame.currentPlayer;

    if (roulettePending) {
        element.textContent = currentGame.currentPlayer === playerId
            ? "🎰 Roulette ! Choisis une couleur"
            : `🎰 ${getPlayerName(currentGame.currentPlayer)} choisit une couleur (Roulette)`;
        element.className = currentGame.currentPlayer === playerId ? "my-turn" : "other-turn";
        return;
    }

    if (currentGame.currentPlayer === playerId) {
        if (isNoMercy() && stack > 0) {
            element.textContent = `💥 Attaque ! Contre-attaque ou pioche ${stack} cartes`;
        } else {
            element.textContent = "🟢 C'est ton tour !";
        }
        element.className = "my-turn";
    } else {
        element.textContent = isNoMercy() && stack > 0
            ? `⏳ Ce n'est pas ton tour... (cumul : +${stack})`
            : "⏳ Ce n'est pas ton tour...";
        element.className = "other-turn";
    }
}

function updateGameButtons() {
    const drawButton = document.getElementById("draw-card");
    const passButton = document.getElementById("pass-turn");
    if (!drawButton || !passButton) return;

    if (!currentGame || isEliminated()) {
        drawButton.disabled = true;
        passButton.disabled = true;
        return;
    }

    const myTurn = isMyTurnNow();
    const stack = currentGame.stackCount || 0;
    const roulettePending = !!currentGame.pendingRoulette;

    drawButton.disabled = !myTurn || hasDrawnThisTurn || roulettePending;
    passButton.disabled = !myTurn || !hasDrawnThisTurn || roulettePending;

    // Sous une attaque, piocher = encaisser tout le cumul
    drawButton.textContent = (isNoMercy() && myTurn && stack > 0) ? `Piocher +${stack}` : "Piocher";
}

function updateUnoButton() {
    const unoButton = document.getElementById("uno-button");
    if (!unoButton) return;

    if (!currentGame) {
        unoButton.style.display = "none";
        return;
    }

    const myHand = currentGame.hands[playerId];
    if (!myHand || myHand.length !== 1) {
        unoButton.style.display = "none";
        return;
    }

    const unoRequired = currentGame.unoRequired && currentGame.unoRequired[playerId] === true;
    const unoCalled = currentGame.unoCalled && currentGame.unoCalled[playerId] === true;

    unoButton.style.display = (unoRequired && !unoCalled) ? "block" : "none";
}

// ===========================================================================
// CHOIX DE COULEUR & CHOIX DE CIBLE (7)
// ===========================================================================

// true quand le joueur doit choisir la couleur d'une Roulette posée juste avant lui
let rouletteChoiceActive = false;

function showColorChoice(message = "Choisis une couleur") {
    const colorChoice = document.getElementById("color-choice");
    const text = document.querySelector("#color-choice-box p");
    if (text) text.textContent = message;
    if (colorChoice) colorChoice.style.display = "flex";
}

function hideColorChoice() {
    const colorChoice = document.getElementById("color-choice");
    if (colorChoice) colorChoice.style.display = "none";
}

// Affiche (ou retire) automatiquement le choix de couleur de la Roulette
// quand c'est à moi de choisir. Appelé à chaque mise à jour de la salle.
function checkPendingRoulette() {
    const mustChoose = isNoMercy()
        && !!currentGame?.pendingRoulette
        && currentGame.pendingRoulette.playerId === playerId
        && isMyTurnNow()
        && !isEliminated();

    if (mustChoose && !rouletteChoiceActive) {
        rouletteChoiceActive = true;
        pendingWildCard = null;
        removeChoiceModal();
        showColorChoice("🎰 Roulette ! Choisis une couleur : tu piocheras jusqu'à l'obtenir");
    } else if (!mustChoose && rouletteChoiceActive) {
        rouletteChoiceActive = false;
        hideColorChoice();
    }
}

// Le joueur a choisi sa couleur : il pioche jusqu'à l'obtenir, puis son tour est passé
async function submitRouletteColor(color) {
    const playerIds = getPlayerIds();

    const success = noMercyRules.chooseRouletteColor(currentGame, playerId, color, playerIds, finishOrder);
    if (!success) return;

    rouletteChoiceActive = false;
    hideColorChoice();
    hasDrawnThisTurn = false;

    // Une élimination peut terminer la partie
    const extra = updateFinishOrder();

    displayMyHand(currentGame.hands[playerId]);
    displayTurnInfo();
    updateGameButtons();
    updateUnoButton();
    updateBackgroundColor();

    await saveGame(extra);

    playDrawSound();
}

document.querySelectorAll("#color-choice button").forEach(button => {
    button.addEventListener("click", async () => {
        const color = button.dataset.color;

        // Roulette : le choix est obligatoire et ne joue pas de carte
        if (rouletteChoiceActive) {
            await submitRouletteColor(color);
            return;
        }

        if (!pendingWildCard) return;

        const card = pendingWildCard;
        pendingWildCard = null;
        hideColorChoice();

        await playSelectedCard(card, { color: color });
    });
});

// Cliquer à côté de la boîte annule le choix (sauf pour la Roulette : obligatoire)
document.getElementById("color-choice")?.addEventListener("click", (event) => {
    if (event.target.id === "color-choice" && !rouletteChoiceActive) {
        pendingWildCard = null;
        hideColorChoice();
    }
});

function removeChoiceModal() {
    document.getElementById("choice-modal")?.remove();
}

// Fenêtre de choix générique : choices = [{ label, onSelect }]
function showChoiceModal(titleText, choices) {
    removeChoiceModal();

    const overlay = document.createElement("div");
    overlay.id = "choice-modal";
    Object.assign(overlay.style, {
        position: "fixed",
        inset: "0",
        zIndex: "2000",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0, 0, 0, 0.45)",
        backdropFilter: "blur(4px)"
    });

    const box = document.createElement("div");
    Object.assign(box.style, {
        padding: "25px",
        borderRadius: "20px",
        background: "rgba(255, 255, 255, 0.95)",
        boxShadow: "0 10px 30px rgba(0, 0, 0, 0.3)",
        textAlign: "center",
        display: "flex",
        flexDirection: "column",
        gap: "10px",
        minWidth: "240px"
    });

    const title = document.createElement("p");
    title.textContent = titleText;
    Object.assign(title.style, {
        margin: "0 0 10px",
        color: "#333",
        fontSize: "18px",
        fontWeight: "700"
    });
    box.appendChild(title);

    choices.forEach(choice => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = choice.label;
        button.addEventListener("click", async () => {
            removeChoiceModal();
            await choice.onSelect();
        });
        box.appendChild(button);
    });

    overlay.appendChild(box);

    // Cliquer à côté de la boîte annule (la carte n'est pas jouée)
    overlay.addEventListener("click", (event) => {
        if (event.target === overlay) removeChoiceModal();
    });

    document.body.appendChild(overlay);
}

// Carte 7 : échanger sa main avec un adversaire, ou avec personne
function showTargetChoice(card) {
    const opponents = noMercyRules
        .getActivePlayers(currentGame, getPlayerIds(), finishOrder)
        .filter(id => id !== playerId);

    const choices = opponents.map(id => {
        const count = currentGame.hands[id]?.length || 0;
        return {
            label: `${getPlayerName(id)} — ${count} carte${count > 1 ? "s" : ""}`,
            onSelect: () => playSelectedCard(card, { targetPlayerId: id })
        };
    });

    choices.push({
        label: "🚫 Avec personne",
        onSelect: () => playSelectedCard(card, {})
    });

    showChoiceModal("🔀 Échanger ta main avec qui ?", choices);
}

// Carte 0 : faire tourner les mains, ou ne rien faire
function showRotateChoice(card) {
    showChoiceModal("🔄 Faire tourner les mains ?", [
        {
            label: "🔄 Oui, faire tourner",
            onSelect: () => playSelectedCard(card, { rotate: true })
        },
        {
            label: "🚫 Avec personne (ne pas faire tourner)",
            onSelect: () => playSelectedCard(card, {})
        }
    ]);
}

// ===========================================================================
// NAVIGATION ENTRE LES ÉCRANS
// ===========================================================================

document.getElementById("choose-mode-button")?.addEventListener("click", () => {
    document.getElementById("home-screen").style.display = "none";
    document.getElementById("mode-screen").style.display = "flex";
});

document.getElementById("duo-mode-button")?.addEventListener("click", () => {
    currentGameMode = "duo";
    applyModeUI();
    document.getElementById("mode-screen").style.display = "none";
    document.getElementById("connection-screen").style.display = "flex";
});

document.getElementById("no-mercy-mode-button")?.addEventListener("click", () => {
    currentGameMode = "duo-no-mercy";
    applyModeUI();
    document.getElementById("mode-screen").style.display = "none";
    document.getElementById("connection-screen").style.display = "flex";
});

document.getElementById("host-game-button")?.addEventListener("click", async () => {
    const playerName = document.getElementById("player-name").value.trim();
    if (!playerName) {
        document.getElementById("player-name-message").textContent = "Entre ton pseudo pour continuer.";
        return;
    }
    document.getElementById("player-name-message").textContent = "";
    await createRoom();
});

document.getElementById("confirm-join-room")?.addEventListener("click", async () => {
    const playerName = document.getElementById("player-name").value.trim();
    if (!playerName) {
        document.getElementById("player-name-message").textContent = "Entre ton pseudo pour continuer.";
        return;
    }
    document.getElementById("player-name-message").textContent = "";
    await joinRoom();
});

function updateGameInterface(roomStatus) {
    const lobbyContent = document.getElementById("lobby-content");
    const playerNameContainer = document.getElementById("player-name-container");
    const backHomeButton = document.getElementById("back-home-button");
    const winnerMessage = document.getElementById("winner-message");

    const gameElements = [
        "my-hand-title", "my-hand", "discard-section",
        "turn-info", "draw-card", "pass-turn", "uno-button"
    ];

    // Le sélecteur de couleur ne doit apparaître que sur demande (display: none par défaut en CSS)
    if (roomStatus === "waiting") {
        if (lobbyContent) lobbyContent.style.display = "";
        if (playerNameContainer) playerNameContainer.style.display = "none";
        if (backHomeButton) backHomeButton.style.display = "";
        if (winnerMessage) winnerMessage.style.display = "none";

        gameElements.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = "none";
        });
    }

    if (roomStatus === "playing") {
        if (lobbyContent) lobbyContent.style.display = "none";
        if (playerNameContainer) playerNameContainer.style.display = "none";
        if (winnerMessage) winnerMessage.style.display = "none";

        gameElements.forEach(id => {
            const el = document.getElementById(id);
            if (el && id !== "uno-button") el.style.display = "";
        });
    }

    if (roomStatus === "finished") {
        if (lobbyContent) lobbyContent.style.display = "none";
        if (playerNameContainer) playerNameContainer.style.display = "none";
        if (winnerMessage) winnerMessage.style.display = "flex";

        gameElements.forEach(id => {
            const el = document.getElementById(id);
            if (el && id !== "uno-button") el.style.display = "";
        });
    }
}

document.getElementById("back-home-button")?.addEventListener("click", async () => {
    const roomCode = currentRoomCode;

    // Arrête d'écouter la salle et ma main
    if (unsubscribeRoom) { unsubscribeRoom(); unsubscribeRoom = null; }
    if (unsubscribeHand) { unsubscribeHand(); unsubscribeHand = null; }

    document.getElementById("game-interface").style.display = "none";
    document.getElementById("home-screen").style.display = "flex";
    document.getElementById("mode-screen").style.display = "none";
    document.getElementById("connection-screen").style.display = "none";

    if (roomCode && playerId) {
        const roomRef = ref(db, `rooms/${roomCode}`);
        await runTransaction(roomRef, room => {
            if (!room) return;
            const players = room.players || {};
            const pIds = Object.keys(players);

            if (pIds.length === 1 && pIds[0] === playerId) {
                return null;
            }

            delete players[playerId];
            room.players = players;
            return room;
        });
    }

    currentRoomCode = null;
    currentGame = null;
    currentGameMode = "duo";
    hasDrawnThisTurn = false;
    pendingWildCard = null;
    finishOrder = [];
    hasCalledUno = false;
    drawnCardId = null;
    lastDuoAnnouncementTimestamp = null;
    lastCardPlayedTimestamp = null;
    lastEventTimestamp = null;
    roomSnapshotReceived = false;
    victorySoundPlayed = false;
    roomPlayers = {};

    rouletteChoiceActive = false;
    removeChoiceModal();
    hideColorChoice();
    applyModeUI();

    const playerNameContainer = document.getElementById("player-name-container");
    const backHomeButton = document.getElementById("back-home-button");

    if (playerNameContainer) playerNameContainer.style.display = "";
    if (backHomeButton) backHomeButton.style.display = "none";

    const discardPile = document.getElementById("discard-pile");
    if (discardPile) discardPile.innerHTML = "";

    const myHand = document.getElementById("my-hand");
    if (myHand) myHand.innerHTML = "";

    const playersList = document.getElementById("players-list");
    if (playersList) playersList.innerHTML = "";

    const winnerMessage = document.getElementById("winner-message");
    if (winnerMessage) winnerMessage.style.display = "none";

    document.body.style.setProperty("--game-start", "#6a5acd");
    document.body.style.setProperty("--game-end", "#00bcd4");
});

// ===========================================================================
// EFFETS SONORES
// ===========================================================================

function playDuoSound() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(520, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(820, ctx.currentTime + 0.15);

    gain.gain.setValueAtTime(0.001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.35);
}

function playCardSound() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "square";
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.exponentialRampToValueAtTime(90, now + 0.08);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.22, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.09);
}

function playDrawSound() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const now = ctx.currentTime;

    const buffer = ctx.createBuffer(1, ctx.sampleRate * 0.12, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
        data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) * 0.8;
    }

    const noise = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    noise.buffer = buffer;
    filter.type = "highpass";
    filter.frequency.setValueAtTime(700, now);
    filter.frequency.exponentialRampToValueAtTime(1800, now + 0.12);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.16, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    noise.start(now);
}

function playCardHoverSound() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(320, now);
    osc.frequency.exponentialRampToValueAtTime(520, now + 0.06);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.06, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.07);
}

function playVictorySound() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const now = ctx.currentTime;

    const notes = [
        { frequency: 523.25, time: 0 },
        { frequency: 659.25, time: 0.12 },
        { frequency: 783.99, time: 0.24 },
        { frequency: 1046.50, time: 0.38 }
    ];

    notes.forEach(note => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = "triangle";
        osc.frequency.setValueAtTime(note.frequency, now + note.time);

        gain.gain.setValueAtTime(0.001, now + note.time);
        gain.gain.exponentialRampToValueAtTime(0.18, now + note.time + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + note.time + 0.35);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now + note.time);
        osc.stop(now + note.time + 0.35);
    });
}

// ===========================================================================
// AMIS & PROFIL
// ===========================================================================

document.getElementById("news-button")?.addEventListener("click", () => {
    document.getElementById("news-popup").style.display = "flex";
});

document.getElementById("close-news-button")?.addEventListener("click", () => {
    document.getElementById("news-popup").style.display = "none";
});

document.getElementById("copy-duo-id-button")?.addEventListener("click", async () => {
    const duoId = localStorage.getItem("duo-player-id");
    if (!duoId) return;

    try {
        await navigator.clipboard.writeText(duoId);
        const button = document.getElementById("copy-duo-id-button");
        button.textContent = "✓";
        setTimeout(() => { button.textContent = "📋"; }, 1500);
    } catch (error) {
        console.error("Impossible de copier le DUO ID :", error);
    }
});

async function validatePlayerName() {
    const input = document.getElementById("player-name");
    const playerName = input.value.trim();
    const message = document.getElementById("player-name-message");

    if (!playerName) {
        message.textContent = "Entre ton pseudo pour continuer.";
        return;
    }

    message.textContent = "";
    localStorage.setItem("duo-player-name", playerName);

    const duoId = getOrCreateDuoId();

    if (playerId) {
        await update(ref(db, `users/${playerId}`), { username: playerName, duoId: duoId });
        await set(ref(db, `duoIds/${duoId}`), playerId);
    }

    document.getElementById("player-profile-username").textContent = playerName;
}

document.getElementById("validate-player-name-button")?.addEventListener("click", validatePlayerName);
document.getElementById("player-name")?.addEventListener("keydown", event => {
    if (event.key === "Enter") validatePlayerName();
});

document.getElementById("add-friend-button")?.addEventListener("click", async () => {
    const input = document.getElementById("friend-duo-id-input");
    const duoId = input.value.trim().toUpperCase();
    if (!duoId) return;

    const snapshot = await get(ref(db, `duoIds/${duoId}`));
    if (!snapshot.exists()) return;

    const friendUid = snapshot.val();
    const existingFriend = await get(ref(db, `users/${playerId}/friends/${friendUid}`));
    if (existingFriend.exists()) return;

    await set(ref(db, `users/${friendUid}/friendRequests/${playerId}`), {
        username: document.getElementById("player-name").value.trim(),
        duoId: localStorage.getItem("duo-player-id"),
        timestamp: Date.now()
    });
});

async function loadFriends() {
    if (!playerId) return;
    const snapshot = await get(ref(db, `users/${playerId}/friends`));
    const noFriendsMsg = document.getElementById("no-friends-message");

    if (!snapshot.exists()) {
        if (noFriendsMsg) noFriendsMsg.textContent = "Aucun ami pour le moment";
        return;
    }

    if (noFriendsMsg) noFriendsMsg.style.display = "none";
    const friendsList = document.getElementById("friends-list");
    if (!friendsList) return;
    friendsList.innerHTML = "";

    for (const friendUid of Object.keys(snapshot.val())) {
        const friendSnap = await get(ref(db, `users/${friendUid}`));
        if (!friendSnap.exists()) continue;

        const profile = friendSnap.val();
        const friendElement = document.createElement("div");
        friendElement.className = "friend-item";
        friendElement.innerHTML = `
            <div>
                <div>👤 ${profile.username || "Joueur"}</div>
                <div style="font-size: 11px; opacity: 0.6; margin-top: 2px;">${profile.duoId || ""}</div>
            </div>
        `;
        friendsList.appendChild(friendElement);
    }
}

async function loadFriendRequests() {
    if (!playerId) return;
    const snapshot = await get(ref(db, `users/${playerId}/friendRequests`));
    if (!snapshot.exists()) return;

    const requestsList = document.getElementById("friend-requests-list");
    if (!requestsList) return;
    requestsList.innerHTML = "";

    const requests = snapshot.val();
    for (const requesterUid of Object.keys(requests)) {
        const req = requests[requesterUid];
        const requestElement = document.createElement("div");
        requestElement.className = "friend-request-item";
        requestElement.innerHTML = `
            <div class="friend-request-info">
                <div>👤 ${req.username || "Joueur"}</div>
                <div class="friend-request-actions">
                    <button type="button" class="accept-friend-button" data-requester-uid="${requesterUid}">✓</button>
                    <button type="button" class="decline-friend-button" data-requester-uid="${requesterUid}">✕</button>
                </div>
            </div>
        `;
        requestsList.appendChild(requestElement);
    }

    document.querySelectorAll(".accept-friend-button").forEach(btn => {
        btn.addEventListener("click", async () => {
            const reqUid = btn.dataset.requesterUid;
            await update(ref(db), {
                [`users/${playerId}/friends/${reqUid}`]: true,
                [`users/${reqUid}/friends/${playerId}`]: true,
                [`users/${playerId}/friendRequests/${reqUid}`]: null
            });
            await loadFriends();
            await loadFriendRequests();
        });
    });

    document.querySelectorAll(".decline-friend-button").forEach(btn => {
        btn.addEventListener("click", async () => {
            const reqUid = btn.dataset.requesterUid;
            await set(ref(db, `users/${playerId}/friendRequests/${reqUid}`), null);
            await loadFriendRequests();
        });
    });
}