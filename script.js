let currentVersion = "DUO v0.5.0";

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

import { getAuth } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";

// Les deux moteurs de règles : le mode de la salle décide lequel est utilisé
import * as duoRules from "./game/duo.js";
import * as noMercyRules from "./game/duo-no-mercy.js";

// Skins de cartes (paquets) + barre de personnalisation
import { getCardImagePath, initSkinSidebar, isSkinNegative, SKINS, DECKS } from "./skins.js";

// Niveaux, EXP et récompenses de fin de partie
import { initProgress, handleRoomProgress, getServerTime, recordFriendsCount } from "./progress.js";

// Comptes : connexion e-mail / Google pour retrouver sa progression sur tous ses appareils
import { initAccount, renderAccountBanner, pushEquippedSkins } from "./account.js";

let playerId = null;
let currentRoomCode = null;
let currentGame = null;
let currentGameMode = "duo"; // "duo" ou "duo-no-mercy" (synchronisé depuis la salle)
let currentHostId = null;    // hôte de la salle (seul à pouvoir changer le mode)
let currentRoomStatus = null; // "waiting", "playing" ou "finished"
let wasMyTurn = false;        // sert à faire vibrer le téléphone quand c'est ton tour
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

// Petit écran (téléphone, tablette en portrait, téléphone en paysage) : même condition que le CSS mobile
function isMobileLayout() {
    return window.matchMedia("(max-width: 820px), (pointer: coarse) and (max-height: 500px)").matches;
}

// Le téléphone vibre brièvement quand c'est ton tour (Android ; ignoré sur PC)
function vibrateOnMyTurn() {
    if (!window.matchMedia("(pointer: coarse)").matches) return;
    if (typeof navigator.vibrate === "function") navigator.vibrate(120);
}

function isNoMercy() {
    return currentGameMode === "duo-no-mercy";
}

function getRules() {
    return isNoMercy() ? noMercyRules : duoRules;
}

// Met à jour le choix du mode dans le salon (carte sélectionnée + texte d'aide)
function applyModeUI() {
    const isHost = currentHostId === playerId;

    document.querySelectorAll("#lobby-modes .mode-card[data-mode]").forEach(card => {
        card.classList.toggle("selected", card.dataset.mode === currentGameMode);
        card.classList.toggle("readonly", !isHost);
    });

    const hint = document.getElementById("lobby-mode-hint");
    if (hint) {
        hint.textContent = isHost
            ? "Clique sur un mode pour le choisir. Tu peux le changer tant que la partie n'est pas lancée."
            : "Seul l'hôte peut changer le mode de jeu.";
    }
}

// Ordre des places : stable en No Mercy (game.order), sinon les joueurs ayant une main
// Firebase trie les clés d'un objet par ordre alphabétique (pas par ordre d'arrivée) :
// sans "order", le même joueur commencerait toujours en premier. On mémorise donc
// l'ordre (mélangé au hasard) choisi au lancement de la partie, pour les deux modes.
function getPlayerIds() {
    if (!currentGame) return [];
    if (currentGame.order) return currentGame.order;
    return Object.keys(currentGame.hands || {}); // parties lancées avant ce correctif
}

// Mélange aléatoirement un tableau (Fisher-Yates), sans modifier l'original
function shuffleArray(array) {
    const result = [...array];
    for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
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

// Connexion : account.js restaure le compte (ou crée un compte invité), puis appelle onUser
initAccount({
    auth,
    db,
    onUser: async (user) => {
        playerId = user.uid;
        initProgress({ db, playerId });
        renderAccountBanner();
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
    }
}).catch((error) => {
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
    currentHostId = playerId;
    roomSnapshotReceived = false;
    document.getElementById("connection-screen").style.display = "none";
    document.getElementById("game-interface").style.display = "block";
    document.body.classList.add("in-game"); // cache la pastille de niveau en salon / en jeu
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
    document.body.classList.add("in-game"); // cache la pastille de niveau en salon / en jeu
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

        // Le mode, l'hôte et le statut viennent de la salle
        // (l'hôte peut changer le mode dans le salon, tout le monde est mis à jour)
        if (room.mode) currentGameMode = room.mode;
        currentHostId = room.hostId || null;
        currentRoomStatus = room.status;
        applyModeUI();

        if (room.status === "waiting") statusElement.textContent = "🟢 En attente de joueurs...";
        if (room.status === "playing") statusElement.textContent = "🎮 Partie en cours !";
        if (room.status === "finished") statusElement.textContent = "🏆 Partie terminée !";

        finishOrder = room.finishOrder || [];

        // Fin de partie : attribue l'EXP (une seule fois par partie)
        handleRoomProgress(room, playerId, currentGameMode);

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

            // C'est devenu mon tour : petite vibration sur téléphone
            const nowMyTurn = room.status === "playing" && currentGame.currentPlayer === playerId;
            if (nowMyTurn && !wasMyTurn) vibrateOnMyTurn();
            wasMyTurn = nowMyTurn;

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

                // On garde l'ordre de placement d'origine (getPlayerIds), pas l'ordre alphabétique
                // de Firebase, sinon le calcul du tour suivant serait décalé par rapport à la vraie table
                const remainingPlayerIds = getPlayerIds().filter(id => currentGame.hands[id]);

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

        // Retour au salon : il n'y a plus de partie, on remet l'affichage à zéro
        if (!room.game && currentGame) {
            currentGame = null;
            hasDrawnThisTurn = false;
            drawnCardId = null;

            displayMyHand(null);
            displayDiscardCard(null);
            displayTurnInfo();
            updateGameButtons();
            updateUnoButton();
            updateBackgroundColor();
            checkPendingRoulette();
            displayPlayers(room.players, room.hostId);
            updateHostUI(room.hostId);
        }
    });
}

// ===========================================================================
// AFFICHAGE : JOUEURS, CLASSEMENT, MESSAGES
// ===========================================================================

// Joueur qui jouera juste après le joueur actuel (null s'il n'y en a pas)
function getNextPlayerId() {
    if (!currentGame?.currentPlayer || currentRoomStatus === "finished") return null;

    // On calcule sur une copie : nextPlayer() modifie le joueur courant
    const probe = { ...currentGame };
    getRules().nextPlayer(probe, getPlayerIds(), finishOrder);

    return probe.currentPlayer !== currentGame.currentPlayer ? probe.currentPlayer : null;
}

function refreshPlayersList() {
    displayPlayers(roomPlayers, currentHostId);
}

// Signaux "c'est à toi" : halo doré autour de l'écran (classe sur le body) et titre de l'onglet
function updateTurnIndicators(isMyTurn) {
    document.body.classList.toggle("my-turn", !!isMyTurn);
    document.title = isMyTurn ? "🟢 À toi de jouer ! · DUO" : "DUO";
}

const PLACE_BADGES = ["🥇 1er", "🥈 2e", "🥉 3e"];

function displayPlayers(players, hostId) {
    const list = document.getElementById("players-list");
    if (!list) return;

    list.innerHTML = "";
    list.classList.remove("turn-rail");
    delete list.dataset.direction;

    if (!players) return;

    // Salon : simple liste des joueurs
    if (!currentGame) {
        Object.entries(players).forEach(([id, player]) => {
            const li = document.createElement("li");
            li.textContent = `${id === hostId ? "👑 " : ""}${player.name}`;
            list.appendChild(li);
        });
        return;
    }

    // Partie : "rail" des joueurs avec qui joue, qui joue ensuite, le sens du jeu
    const finished = currentRoomStatus === "finished";
    const nextId = finished ? null : getNextPlayerId();
    const playerIds = getPlayerIds();

    list.classList.add("turn-rail");

    // Le sens du jeu n'a d'intérêt qu'à partir de 3 joueurs encore en lice
    if (!finished && getRemainingPlayers(playerIds).length >= 3) {
        list.dataset.direction = currentGame.direction === -1 ? "backward" : "forward";
    }

    Object.entries(players).forEach(([id, player]) => {
        const hand = currentGame.hands?.[id];
        const eliminated = !!currentGame.eliminated?.includes(id);
        const rank = finishOrder.indexOf(id);

        const isCurrent = !finished && !eliminated && rank === -1 && currentGame.currentPlayer === id;
        const isNext = !finished && id === nextId;

        // Badge au-dessus du nom
        let badge = "";
        if (eliminated) badge = "💀 Éliminé";
        else if (rank >= 0) badge = PLACE_BADGES[rank] || `🏅 ${rank + 1}e`;
        else if (isCurrent) badge = "🟢 Joue";
        else if (isNext) badge = "⏭️ Prochain";

        // Nombre de cartes
        let cards;
        if (eliminated) {
            cards = "—";
        } else if (rank >= 0 && !(hand && hand.length > 0)) {
            cards = "terminé";
        } else if (hand) {
            cards = `${hand.length} carte${hand.length > 1 ? "s" : ""}`;
            // Avertissement quand on approche de la limite de la pitié
            if (isNoMercy() && hand.length >= noMercyRules.RULES.mercyLimit - 5) cards += " ⚠️";
        } else {
            cards = "—";
        }

        const li = document.createElement("li");
        li.className = "turn-chip";
        if (isCurrent) {
            li.classList.add("current");
            li.setAttribute("aria-current", "true");
        }
        if (isNext) li.classList.add("next");
        if (id === playerId) li.classList.add("me");
        if (eliminated || (rank >= 0 && !finished)) li.classList.add("done");
        if (finished && rank === 0) li.classList.add("winner");

        const badgeElement = document.createElement("span");
        badgeElement.className = "turn-chip-badge";
        badgeElement.textContent = badge;

        const nameElement = document.createElement("span");
        nameElement.className = "turn-chip-name";
        nameElement.textContent = `${id === hostId ? "👑 " : ""}${player.name}${id === playerId ? " (toi)" : ""}`;

        const cardsElement = document.createElement("span");
        cardsElement.className = "turn-chip-cards";
        cardsElement.textContent = cards;

        li.append(badgeElement, nameElement, cardsElement);
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
    // Seul l'hôte peut relancer ou retourner au salon
    const isHost = room.hostId === playerId;
    const actions = document.getElementById("winner-actions");
    const restartButton = document.getElementById("restart-game");
    const lobbyButton = document.getElementById("back-to-lobby-button");
    const waitingMessage = document.getElementById("winner-waiting-host");

    if (actions) actions.style.display = isHost ? "flex" : "none";
    if (restartButton) restartButton.style.display = isHost ? "block" : "none";
    if (lobbyButton) lobbyButton.style.display = isHost ? "block" : "none";
    if (waitingMessage) waitingMessage.style.display = isHost ? "none" : "block";

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

const COLOR_NAMES = { red: "rouge", blue: "bleu", green: "vert", yellow: "jaune" };

function describeGameEvent(event, game) {
    const name = getPlayerName(event.playerId);
    const target = event.targetPlayerId ? getPlayerName(event.targetPlayerId) : "";

    // DUO classique
    if (!isNoMercy()) {
        const colorName = COLOR_NAMES[event.color] || "";

        switch (event.type) {
            case "skip":
                return `🚫 ${name} fait passer le tour de ${target}`;
            case "reverse":
                return target
                    ? `🔄 ${name} inverse le sens : ${target} passe son tour`
                    : `🔄 ${name} inverse le sens du jeu`;
            case "draw2":
                return `➕ ${target} se prend +${event.count ?? 2} (${name}) et passe son tour`;
            case "draw4":
                return `🌈 ${target} se prend +${event.count ?? 4} (${name}) et passe son tour${colorName ? ` · couleur : ${colorName}` : ""}`;
            case "wild":
                return `🌈 ${name} choisit la couleur ${colorName}`;
            default:
                return null;
        }
    }

    // DUO No Mercy
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
    const waitingMessage = document.getElementById("waiting-for-host");
    if (!button) return;

    if (currentGame && currentGame.currentPlayer) {
        button.style.display = "none";
        if (waitingMessage) waitingMessage.style.display = "none";
        return;
    }

    const isHost = hostId === playerId;
    button.style.display = isHost ? "block" : "none";
    if (waitingMessage) waitingMessage.style.display = isHost ? "none" : "block";
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

    // Ordre mélangé au hasard : sinon Firebase renvoie toujours le même ordre
    // (alphabétique) et c'est toujours le même joueur qui commence.
    const playerIds = shuffleArray(Object.keys(room.players || {}));
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
        gameId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, // identifie la partie
        startedAt: getServerTime(),                                         // sert à refuser l'EXP des parties trop courtes
        participants: playerIds,                                            // seuls ces joueurs gagnent de l'EXP
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

// Tri de la main : d'abord par couleur (rouge, bleu, vert, jaune, puis les cartes sans
// couleur comme les jokers), puis par valeur/type à l'intérieur d'une même couleur.
// C'est un tri purement visuel : il ne modifie jamais la main envoyée par le serveur.
const HAND_COLOR_ORDER = { red: 0, blue: 1, green: 2, yellow: 3 };
const HAND_TYPE_ORDER = {
    skip: 10, reverse: 11, draw2: 12,       // cartes "+X / action" de couleur
    draw4_color: 13, discard_all: 14, skip_all: 15, // cartes spéciales No Mercy de couleur
    wild: 100, draw4: 101, draw6: 102, draw10: 103, roulette: 104 // jokers (sans couleur)
};

function getHandSortKey(card) {
    const colorRank = card.color != null ? (HAND_COLOR_ORDER[card.color] ?? 9) : 9;
    const typeRank = card.type === "number" ? (card.value ?? 0) : (HAND_TYPE_ORDER[card.type] ?? 50);
    return [colorRank, typeRank];
}

function sortHandForDisplay(hand) {
    return [...hand].sort((a, b) => {
        const [colorA, typeA] = getHandSortKey(a);
        const [colorB, typeB] = getHandSortKey(b);
        return colorA - colorB || typeA - typeB;
    });
}

function displayMyHand(hand) {
    const container = document.getElementById("my-hand");
    const title = document.getElementById("my-hand-title");
    if (!container) return;

    // Sur mobile la main défile horizontalement : on garde la position à chaque réaffichage
    const previousScroll = container.scrollLeft;
    let drawnElement = null;

    container.innerHTML = "";

    if (!hand) {
        if (title) title.textContent = "Ma main";
        return;
    }

    if (title) {
        title.textContent = `Ma main — ${hand.length} carte${hand.length > 1 ? "s" : ""}`;
    }

    const sortedHand = sortHandForDisplay(hand);

    sortedHand.forEach(card => {
        const imagePath = getCardImage(card);
        const cardElement = document.createElement("img");
        cardElement.src = imagePath;
        cardElement.alt = "Carte UNO";
        cardElement.className = "card-image";
        cardElement.dataset.cardId = card.id;

        if (card.id === drawnCardId) {
            cardElement.classList.add("drawn-card-animation");
            drawnElement = cardElement;
            drawnCardId = null;
        }

        cardElement.addEventListener("click", () => handleCardClick(card));

        container.appendChild(cardElement);
    });

    container.scrollLeft = previousScroll;

    // Mobile : la carte qu'on vient de piocher est ajoutée au bout de la main, on la montre
    if (drawnElement && isMobileLayout()) {
        drawnElement.scrollIntoView({ inline: "center", block: "nearest" });
    }

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

    // (options.color : couleur choisie pour un joker ; options.targetPlayerId : cible du 7 en No Mercy...)
    const success = rules.playCard(currentGame, playerId, card.id, playerIds, finishOrder, options);
    if (!success) return false;

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

// Image d'une carte : dépend du mode de jeu ET du skin équipé (voir skins.js)
function getCardImage(card) {
    return getCardImagePath(currentGameMode, card);
}

// Réaffiche les cartes déjà à l'écran (quand le joueur change de skin en pleine partie)
function refreshCardImages() {
    if (!currentGame) return;

    if (currentGame.hands?.[playerId]) {
        displayMyHand(currentGame.hands[playerId]);
    }

    const pile = currentGame.discardPile;
    if (pile?.length) {
        displayDiscardCard(pile[pile.length - 1]);
    }

    // Le fond suit la couleur en cours : si on vient d'équiper/retirer un skin négatif, il doit s'inverser aussi
    updateBackgroundColor();
    updateColorChoiceButtons();
}

// Barre de personnalisation à droite de l'écran
initSkinSidebar({
    onChange: () => {
        refreshCardImages();
        pushEquippedSkins(); // les skins équipés suivent le compte sur tous les appareils
    }
});

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

// Inverse une couleur hexadécimale (#rrggbb -> couleur "négative")
function invertHexColor(hex) {
    const n = parseInt(hex.slice(1), 16);
    const inverted = 0xffffff - n;
    return `#${inverted.toString(16).padStart(6, "0")}`;
}

function updateBackgroundColor() {
    let startColor = "#6a5acd";
    let endColor = "#00bcd4";

    if (currentGame?.currentColor === "red") { startColor = "#b71c1c"; endColor = "#ef5350"; }
    if (currentGame?.currentColor === "blue") { startColor = "#0a4cda"; endColor = "#2958f1"; }
    if (currentGame?.currentColor === "green") { startColor = "#209425"; endColor = "#57dd5e"; }
    if (currentGame?.currentColor === "yellow") { startColor = "#b48305"; endColor = "#e0b423"; }

    // Skin "négatif" équipé pour ce mode : le fond suit aussi, en couleurs inversées
    if (isSkinNegative(currentGameMode)) {
        startColor = invertHexColor(startColor);
        endColor = invertHexColor(endColor);
    }

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
        updateTurnIndicators(false);
        return;
    }

    const stack = currentGame.stackCount || 0;
    const currentId = currentGame.currentPlayer;
    const currentName = getPlayerName(currentId);
    const finished = currentRoomStatus === "finished";
    const nextId = getNextPlayerId();

    const roulettePending = isNoMercy() && !!currentGame.pendingRoulette
        && currentGame.pendingRoulette.playerId === currentId;

    let message;
    let className = "other-turn";
    let isMyTurn = false;

    if (finished) {
        message = "🏁 Partie terminée";
    } else if (isEliminated()) {
        message = "💀 Tu as été éliminé... Tu regardes la fin de la partie.";
    } else if (finishOrder.includes(playerId)) {
        message = `✅ Tu as terminé ! C'est au tour de ${currentName}`;
    } else if (roulettePending) {
        isMyTurn = currentId === playerId;
        message = isMyTurn
            ? "🎰 Roulette ! Choisis une couleur"
            : `🎰 ${currentName} choisit une couleur (Roulette)`;
        className = isMyTurn ? "my-turn" : "other-turn";
    } else if (currentId === playerId) {
        isMyTurn = true;
        message = isNoMercy() && stack > 0
            ? `💥 Attaque ! Contre-attaque ou pioche ${stack} cartes`
            : "🟢 C'est ton tour !";
        className = "my-turn";
    } else {
        // Pas mon tour : on dit qui joue, et qui joue ensuite (moi, si je suis le prochain)
        const iAmNext = nextId === playerId;

        message = `⏳ C'est au tour de ${currentName}`;
        if (iAmNext) message += " — tu joues juste après !";
        else if (nextId) message += ` · ensuite : ${getPlayerName(nextId)}`;
        if (isNoMercy() && stack > 0) message += ` (cumul : +${stack})`;

        if (iAmNext) className = "other-turn next-turn";
    }

    element.textContent = message;
    element.className = className;

    updateTurnIndicators(isMyTurn);
    refreshPlayersList();
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

// Skin "négatif" équipé : les boutons de couleur affichent le nom de la couleur
// inversée au lieu du rond de couleur habituel (🔴 -> "BLEU CLAIR", etc.)
const NEGATIVE_COLOR_LABELS = { red: "ROUGE", blue: "BLEU", green: "VERT", yellow: "JAUNE" };
const NORMAL_COLOR_EMOJIS = { red: "🔴", blue: "🔵", green: "🟢", yellow: "🟡" };

function updateColorChoiceButtons() {
    const container = document.getElementById("color-choice-buttons");
    if (!container) return;

    const negative = isSkinNegative(currentGameMode);
    container.classList.toggle("negative", negative);

    container.querySelectorAll("button[data-color]").forEach(button => {
        const color = button.dataset.color;
        button.textContent = negative ? NEGATIVE_COLOR_LABELS[color] : NORMAL_COLOR_EMOJIS[color];
    });
}

function showColorChoice(message = "Choisis une couleur") {
    const colorChoice = document.getElementById("color-choice");
    const text = document.querySelector("#color-choice-box p");
    if (text) text.textContent = message;
    updateColorChoiceButtons();
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

// Mobile : toucher en dehors d'une fenêtre latérale (Personnalisation / Niveaux) la ferme.
// Le toucher est "avalé" pour ne pas jouer par erreur une carte située derrière.
document.addEventListener("click", (event) => {
    if (!isMobileLayout()) return;
    if (!event.isTrusted) return; // clics déclenchés par le code (ex : lien vers la boutique) : on les laisse passer
    // la pastille ouvre la fenêtre Niveaux ; les fenêtres au premier plan gardent leurs propres boutons
    if (event.target.closest("#level-chip, #winner-message, #color-choice, #choice-modal, #rules-popup, #news-popup, #account-popup, #achievements-popup")) return;

    const outside = [...document.querySelectorAll("#skin-sidebar.open, #levels-sidebar.open, #shop-sidebar.open")]
        .filter(sidebar => !sidebar.contains(event.target));
    if (outside.length === 0) return;

    outside.forEach(sidebar => {
        sidebar.classList.remove("open");
        sidebar.querySelector("button[aria-expanded]")?.setAttribute("aria-expanded", "false");
    });

    event.stopPropagation();
    event.preventDefault();
}, true);

// "Jouer à DUO !" -> écran créer / rejoindre
document.getElementById("play-button")?.addEventListener("click", () => {
    document.getElementById("home-screen").style.display = "none";
    document.getElementById("connection-screen").style.display = "flex";
});

document.getElementById("connection-back-button")?.addEventListener("click", () => {
    document.getElementById("connection-screen").style.display = "none";
    document.getElementById("home-screen").style.display = "flex";
    document.getElementById("room-code-message").textContent = "";
});

// Entrée dans le champ du code = Rejoindre
document.getElementById("room-code")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") document.getElementById("confirm-join-room")?.click();
});

// ===========================================================================
// SALON : CHOIX DU MODE (hôte), CODE, RETOUR AU SALON
// ===========================================================================

// L'hôte clique sur un mode : tous les joueurs du salon sont mis à jour
document.querySelectorAll("#lobby-modes .mode-card-select[data-mode]").forEach(button => {
    button.addEventListener("click", async () => {
        const mode = button.dataset.mode;

        if (!currentRoomCode || !playerId) return;
        if (currentHostId !== playerId) return;          // seul l'hôte
        if (currentRoomStatus !== "waiting") return;     // pas pendant une partie
        if (mode === currentGameMode) return;

        currentGameMode = mode;                          // affichage immédiat
        applyModeUI();

        await update(ref(db, `rooms/${currentRoomCode}`), { mode: mode });
    });
});

// Copier le code du salon
document.getElementById("copy-room-code-button")?.addEventListener("click", async () => {
    if (!currentRoomCode) return;

    const button = document.getElementById("copy-room-code-button");
    try {
        await navigator.clipboard.writeText(currentRoomCode);
        button.textContent = "✓";
        setTimeout(() => { button.textContent = "📋"; }, 1500);
    } catch (error) {
        console.error("Impossible de copier le code :", error);
    }
});

// Fin de partie : l'hôte retourne au salon (pour changer de mode, par exemple)
document.getElementById("back-to-lobby-button")?.addEventListener("click", async () => {
    if (!currentRoomCode || currentHostId !== playerId) return;

    await update(ref(db, `rooms/${currentRoomCode}`), {
        status: "waiting",
        finishOrder: null,
        game: null,
        hands: null,
        gameId: null,
        startedAt: null,
        participants: null
    });
});

// ===========================================================================
// RÈGLES DES MODES (boutons "📖 Règles" des cartes de mode, dans le salon)
// ===========================================================================

// Pour modifier les règles affichées, il suffit d'éditer ces textes.
const DUO_CALL_RULE = {
    title: "🔔 DUO !",
    items: [
        "Quand il ne te reste qu'une seule carte, appuie vite sur le bouton DUO ! pour l'annoncer à tout le monde."
    ]
};

const MODE_RULES = {
    "duo": {
        title: "🎴 Règles de DUO",
        sections: [
            {
                title: "🎯 But du jeu",
                items: [
                    "Chaque joueur reçoit 7 cartes. Le but est de poser toutes tes cartes le plus vite possible.",
                    "Un joueur qui a posé toutes ses cartes est classé. La partie continue jusqu'à ce qu'il ne reste qu'un seul joueur : c'est le dernier."
                ]
            },
            {
                title: "🃏 Poser une carte",
                items: [
                    "À ton tour, pose une carte de la même couleur, du même chiffre ou du même symbole que la carte sur la table.",
                    "Aucune carte jouable ? Pioche une carte : tu peux la poser si elle convient, sinon passe ton tour."
                ]
            },
            {
                title: "⚡ Cartes spéciales",
                items: [
                    "🚫 Passe : le joueur suivant passe son tour.",
                    "🔄 Inversion : le sens du jeu change (à 2 joueurs, elle fait passer le tour de l'adversaire).",
                    "➕ +2 : le joueur suivant pioche 2 cartes et passe son tour.",
                    "🌈 Joker : tu peux le poser à tout moment et tu choisis la nouvelle couleur.",
                    "🌈 Joker +4 : tu peux le jouer à tout moment. Tu choisis la couleur, le joueur suivant pioche 4 cartes et passe son tour.",
                    "Les cartes +2 et +4 ne se cumulent pas."
                ]
            },
            DUO_CALL_RULE
        ]
    },

    "duo-no-mercy": {
        title: "💀 Règles de DUO NO MERCY",
        sections: [
            {
                title: "🎯 But du jeu",
                items: [
                    "Chaque joueur reçoit 7 cartes. Le but est de poser toutes tes cartes, mais attention : à 25 cartes ou plus en main, tu es éliminé !",
                    "Un joueur qui a posé toutes ses cartes est classé. La partie continue jusqu'à ce qu'il ne reste qu'un seul joueur."
                ]
            },
            {
                title: "🃏 Poser une carte",
                items: [
                    "Pose une carte de la même couleur, du même chiffre ou du même symbole que la carte sur la table. Les jokers se posent sur n'importe quelle carte (sauf quand tu subis une attaque, voir plus bas).",
                    "Pioche : tu ne reçois qu'une seule carte. Si aucune de tes cartes n'est jouable, ton tour passe automatiquement ; sinon tu peux jouer ou passer."
                ]
            },
            {
                title: "💥 Attaques et cumul",
                items: [
                    "Les cartes +2, +4 de couleur, Joker Inversion +4, Joker +6 et Joker +10 font piocher le joueur suivant.",
                    "Quand tu es attaqué, tu peux contre-attaquer avec une attaque aussi forte ou plus forte : les cartes à piocher s'additionnent et passent au joueur suivant.",
                    "Si tu ne contre-attaques pas, tu pioches tout le cumul et ton tour est passé.",
                    "Une fois le cumul pioché, le jeu reprend normalement : le joueur suivant peut de nouveau poser un +2 ou un +4 de la bonne couleur.",
                    "Le Joker Inversion +4 change aussi le sens du jeu ; le +4 de couleur ne le change pas."
                ]
            },
            {
                title: "⚡ Cartes spéciales",
                items: [
                    "🚫 Passe : le joueur suivant passe son tour.",
                    "🔄 Inversion : le sens du jeu change (à 2 joueurs, elle fait passer le tour de l'adversaire).",
                    "⏭️ Passe Tout le Monde : tous les autres joueurs sont passés, tu rejoues.",
                    "🗑️ Défausse Tout : tu défausses toutes tes cartes de la même couleur que cette carte.",
                    "🎰 Roulette : le joueur suivant choisit une couleur, puis pioche jusqu'à obtenir une carte de cette couleur. Son tour est ensuite passé, et la couleur choisie devient la couleur de la table."
                ]
            },
            {
                title: "🔀 Les chiffres 7 et 0",
                items: [
                    "7 : tu peux échanger ta main avec le joueur de ton choix, ou avec personne.",
                    "0 : tu peux faire passer toutes les mains au joueur suivant (dans le sens du jeu), ou ne rien faire.",
                    "Ces effets ne s'appliquent pas quand tu poses ta dernière carte."
                ]
            },
            {
                title: "💀 La règle de la pitié",
                items: [
                    "Dès que tu atteins 25 cartes, tu es éliminé et tes cartes retournent dans la pioche.",
                    "Un ⚠️ apparaît à côté du nom d'un joueur à partir de 20 cartes."
                ]
            },
            DUO_CALL_RULE
        ]
    }
};

function getRulesPopup() {
    let popup = document.getElementById("rules-popup");
    if (popup) return popup;

    popup = document.createElement("div");
    popup.id = "rules-popup";
    popup.style.display = "none";

    const content = document.createElement("div");
    content.id = "rules-popup-content";

    const closeButton = document.createElement("button");
    closeButton.id = "close-rules-button";
    closeButton.type = "button";
    closeButton.textContent = "✕";
    closeButton.addEventListener("click", hideModeRules);

    const title = document.createElement("h2");
    title.id = "rules-popup-title";

    const sections = document.createElement("div");
    sections.id = "rules-popup-sections";

    content.append(closeButton, title, sections);
    popup.appendChild(content);

    // Cliquer à côté de la fenêtre la ferme
    popup.addEventListener("click", (event) => {
        if (event.target === popup) hideModeRules();
    });

    document.body.appendChild(popup);
    return popup;
}

function showModeRules(mode) {
    const rules = MODE_RULES[mode];
    if (!rules) return;

    const popup = getRulesPopup();
    document.getElementById("rules-popup-title").textContent = rules.title;

    const container = document.getElementById("rules-popup-sections");
    container.innerHTML = "";

    rules.sections.forEach(section => {
        const sectionElement = document.createElement("section");
        sectionElement.className = "news-section";

        const heading = document.createElement("h3");
        heading.textContent = section.title;
        sectionElement.appendChild(heading);

        const list = document.createElement("ul");
        section.items.forEach(text => {
            const item = document.createElement("li");
            item.textContent = text;
            list.appendChild(item);
        });
        sectionElement.appendChild(list);

        container.appendChild(sectionElement);
    });

    popup.style.display = "flex";
    document.getElementById("rules-popup-content").scrollTop = 0;
}

function hideModeRules() {
    const popup = document.getElementById("rules-popup");
    if (popup) popup.style.display = "none";
}

document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hideModeRules();
});

// Les boutons "📖 Règles" sont dans le HTML (attribut data-rules = mode)
document.querySelectorAll("[data-rules]").forEach(button => {
    button.addEventListener("click", () => showModeRules(button.dataset.rules));
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
    const lobbySetup = document.getElementById("lobby-setup");
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
        if (lobbySetup) lobbySetup.style.display = "";
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
        if (lobbySetup) lobbySetup.style.display = "none";
        if (playerNameContainer) playerNameContainer.style.display = "none";
        if (winnerMessage) winnerMessage.style.display = "none";

        gameElements.forEach(id => {
            const el = document.getElementById(id);
            if (el && id !== "uno-button") el.style.display = "";
        });
    }

    if (roomStatus === "finished") {
        if (lobbyContent) lobbyContent.style.display = "none";
        if (lobbySetup) lobbySetup.style.display = "none";
        if (playerNameContainer) playerNameContainer.style.display = "none";
        if (winnerMessage) winnerMessage.style.display = "flex";

        gameElements.forEach(id => {
            const el = document.getElementById(id);
            if (el && id !== "uno-button") el.style.display = "";
        });
    }
}

document.getElementById("back-home-button")?.addEventListener("click", async () => {
    // Sur mobile, le bouton est proche des cartes : on demande confirmation en pleine partie
    if (isMobileLayout() && currentRoomStatus === "playing" && !confirm("Quitter la partie en cours ?")) {
        return;
    }

    const roomCode = currentRoomCode;

    // Arrête d'écouter la salle et ma main
    if (unsubscribeRoom) { unsubscribeRoom(); unsubscribeRoom = null; }
    if (unsubscribeHand) { unsubscribeHand(); unsubscribeHand = null; }

    document.getElementById("game-interface").style.display = "none";
    document.body.classList.remove("in-game");
    document.getElementById("home-screen").style.display = "flex";
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
    updateTurnIndicators(false);
    currentGameMode = "duo";
    currentHostId = null;
    currentRoomStatus = null;
    wasMyTurn = false;
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
    renderNewsSkinsGallery(); // le catalogue ne change pas en cours de session : pas besoin de le refaire à chaque fois
});

// Onglets "Nouveautés" / "Nouveaux skins" dans la fenêtre Nouveautés
document.querySelectorAll(".news-tab").forEach(tab => {
    tab.addEventListener("click", () => {
        const target = tab.dataset.newsTab;

        document.querySelectorAll(".news-tab").forEach(t => t.classList.toggle("active", t === tab));
        document.getElementById("news-tab-updates").style.display = target === "updates" ? "" : "none";
        document.getElementById("news-tab-skins").style.display = target === "skins" ? "" : "none";
    });
});

// Un petit badge décrivant comment obtenir un skin ("Gratuit", "Niveau 5", "Boutique · 100 pts")
function getSkinUnlockBadge(skin) {
    if (skin.unlock === "default") return "🆓 Gratuit";
    if (skin.unlock === "level") return `⭐ Niveau ${skin.unlockLevel}`;
    if (skin.unlock === "shop") return `🛒 ${skin.price} pts DUO`;
    return "🔒 À débloquer";
}

let newsSkinsRendered = false;

// Catalogue des skins, rangé par paquet (rempli une fois, le catalogue ne change pas en session)
function renderNewsSkinsGallery() {
    if (newsSkinsRendered) return;
    const gallery = document.getElementById("news-skins-gallery");
    if (!gallery) return;

    Object.entries(DECKS).forEach(([deckId, deck]) => {
        const skins = SKINS.filter(skin => skin.deck === deckId);
        if (skins.length === 0) return;

        const section = document.createElement("section");
        section.className = "news-section news-skins-deck";

        const title = document.createElement("h3");
        title.textContent = `Paquets ${deck.name}`;
        section.appendChild(title);

        const grid = document.createElement("div");
        grid.className = "news-skins-grid";

        skins.forEach(skin => {
            const card = document.createElement("div");
            card.className = "news-skin-card";

            const preview = document.createElement("div");
            preview.className = "news-skin-preview";
            (skin.preview || []).slice(0, 4).forEach(fileName => {
                const img = document.createElement("img");
                img.src = `${skin.folder}${fileName}.${skin.extension || "webp"}`;
                img.alt = "";
                img.loading = "lazy";
                img.addEventListener("error", () => img.remove());
                preview.appendChild(img);
            });
            card.appendChild(preview);

            const name = document.createElement("div");
            name.className = "news-skin-name";
            name.textContent = skin.name;
            card.appendChild(name);

            if (skin.description) {
                const description = document.createElement("div");
                description.className = "news-skin-description";
                description.textContent = skin.description;
                card.appendChild(description);
            }

            const badge = document.createElement("div");
            badge.className = "news-skin-badge";
            badge.textContent = getSkinUnlockBadge(skin);
            card.appendChild(badge);

            grid.appendChild(card);
        });

        section.appendChild(grid);
        gallery.appendChild(section);
    });

    newsSkinsRendered = true;
}

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

// Retourne le nombre d'amis (utilisé pour le succès "Sociable")
async function loadFriends() {
    if (!playerId) return 0;
    const snapshot = await get(ref(db, `users/${playerId}/friends`));
    const noFriendsMsg = document.getElementById("no-friends-message");

    if (!snapshot.exists()) {
        if (noFriendsMsg) noFriendsMsg.textContent = "Aucun ami pour le moment";
        return 0;
    }

    if (noFriendsMsg) noFriendsMsg.style.display = "none";
    const friendsList = document.getElementById("friends-list");
    const friendIds = Object.keys(snapshot.val());
    if (!friendsList) return friendIds.length;
    friendsList.innerHTML = "";

    for (const friendUid of friendIds) {
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

    return friendIds.length;
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
            const friendsCount = await loadFriends();
            await loadFriendRequests();
            recordFriendsCount(friendsCount);
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