let currentVersion = "DUO v0.2"

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

import {
    createGameState as createDuoGameState,
    canPlayCard as canPlayDuoCard,
    playCard as playDuoCard,
    drawCard as drawDuoCard,
    isMyTurn as isDuoMyTurn,
    nextPlayer as nextDuoPlayer
} from "./game/duo.js";

let playerId = null;
let currentRoomCode = null;
let currentGame = null;
let currentGameMode = "duo";
let hasDrawnThisTurn = false;
let pendingWildCard = null;
let finishOrder = [];
let hasCalledUno = false;
let drawnCardId = null;
let lastDuoAnnouncementTimestamp = null;
let lastCardPlayedTimestamp = null;
let victorySoundPlayed = false;

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

// Événements d'initialisation de l'UI
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

async function createRoom() {
    if (!playerId) {
        alert("Connexion à Firebase en cours...");
        return;
    }

    const playerName = document.getElementById("player-name").value.trim();
    localStorage.setItem("duo-player-name", playerName);

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

    await update(ref(db, `users/${playerId}`), { username: playerName, duoId: duoId });
    await set(ref(db, `duoIds/${duoId}`), playerId);

    if (!playerName) {
        document.getElementById("player-name-message").textContent = "Entre ton pseudo pour continuer.";
        return;
    }

    document.getElementById("player-name-message").textContent = "";
    const roomCode = generateRoomCode();
    const roomRef = ref(db, `rooms/${roomCode}`);

    await set(roomRef, {
        status: "waiting",
        hostId: playerId,
        createdAt: Date.now(),
        players: {
            [playerId]: { name: playerName, joinedAt: Date.now() }
        }
    });

    const playerRef = ref(db, `rooms/${roomCode}/players/${playerId}`);
    onDisconnect(playerRef).remove();

    currentRoomCode = roomCode;
    document.getElementById("connection-screen").style.display = "none";
    document.getElementById("game-interface").style.display = "block";
    document.getElementById("room-info").textContent = `Salon : ${roomCode}`;

    listenToRoom(roomCode);
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

    const playerRef = ref(db, `rooms/${roomCode}/players/${playerId}`);
    await set(playerRef, { name: playerName, joinedAt: Date.now() });
    onDisconnect(playerRef).remove();

    currentRoomCode = roomCode;
    document.getElementById("connection-screen").style.display = "none";
    document.getElementById("game-interface").style.display = "block";
    document.getElementById("room-info").textContent = `Salon : ${roomCode}`;

    listenToRoom(roomCode);
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

function listenToRoom() {
    if (!currentRoomCode) return;
    const roomRef = ref(db, `rooms/${currentRoomCode}`);

    onValue(roomRef, async (snapshot) => {
        const room = snapshot.val();
        const statusElement = document.getElementById("status");

        if (!room) return;

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

            currentGame = {
                ...room.game,
                hands: room.hands,
                unoCalled: room.game.unoCalled || {},
                unoRequired: room.game.unoRequired || {}
            };

            if (currentGame.hands && currentGame.hands[playerId]) {
                displayMyHand(currentGame.hands[playerId]);
            }

            for (const id of Object.keys(currentGame.hands || {})) {
                if (currentGame.hands[id]?.length === 1) {
                    await set(ref(db, `rooms/${currentRoomCode}/game/unoRequired/${id}`), true);
                }
            }

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

                if (remainingPlayerIds.length === 1) {
                    await update(roomRef, {
                        status: "finished",
                        hands: currentGame.hands,
                        game: {
                            ...room.game,
                            currentPlayer: remainingPlayerIds[0],
                            unoCalled: currentGame.unoCalled,
                            unoRequired: currentGame.unoRequired
                        }
                    });
                    return;
                }

                if (leftPlayers.includes(currentGame.currentPlayer) && remainingPlayerIds.length > 1) {
                    nextDuoPlayer(currentGame, remainingPlayerIds, finishOrder);
                }

                await update(roomRef, {
                    hands: currentGame.hands,
                    game: {
                        ...room.game,
                        currentPlayer: currentGame.currentPlayer,
                        unoCalled: currentGame.unoCalled,
                        unoRequired: currentGame.unoRequired
                    }
                });
            }

            displayTurnInfo();
            updateGameButtons();
            updatePlayableCards();
            updateUnoButton();
            displayPlayers(room.players, room.hostId);
            updateBackgroundColor();
        }

        if (room.game?.discardPile) {
            displayDiscardCard(room.game.discardPile[room.game.discardPile.length - 1]);
        }
    });
}

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

        let cardCount = currentGame?.hands?.[id] ? ` — ${currentGame.hands[id].length} carte(s)` : "";
        li.textContent = `${prefix}${player.name}${cardCount}`;
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
    let html = "<h2>🏆 Classement final</h2>";

    ranking.forEach((pId, index) => {
        const player = players[pId];
        if (!player) return;
        let medal = index === 0 ? "🥇" : index === 1 ? "🥈" : index === 2 ? "🥉" : `${index + 1}.`;
        html += `<p>${medal} ${player.name}</p>`;
    });

    finalRanking.innerHTML = html;
    const restartButton = document.getElementById("restart-game");
    if (restartButton) {
        restartButton.style.display = room.hostId === playerId ? "block" : "none";
    }

    winnerMessage.style.display = "flex";
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

async function startGame() {
    victorySoundPlayed = false;
    if (!currentRoomCode || !playerId) return;

    const roomRef = ref(db, `rooms/${currentRoomCode}`);
    const snapshot = await get(roomRef);
    const room = snapshot.val();

    if (!room || room.hostId !== playerId) return;

    const playerIds = Object.keys(room.players || {});
    const game = createDuoGameState(playerIds);
    finishOrder = [];

    await update(roomRef, {
        status: "playing",
        finishOrder: [],
        game: {
            deck: game.deck,
            discardPile: game.discardPile,
            currentPlayer: game.currentPlayer,
            direction: game.direction,
            currentColor: game.currentColor,
            unoCalled: {},
            unoRequired: {},
            lastDraw4Player: null,
            draw4PreviousColor: null
        },
        hands: game.hands
    });

    currentGame = {
        ...game,
        unoCalled: {},
        unoRequired: {}
    };

    displayMyHand(game.hands[playerId]);
    displayDiscardCard(game.discardPile[game.discardPile.length - 1]);
    displayTurnInfo();
    updateGameButtons();
    updatePlayableCards();
    updateUnoButton();
    updateBackgroundColor();
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

        if (card.id === drawnCardId) {
            cardElement.classList.add("drawn-card-animation");
            drawnCardId = null;
        }

        cardElement.addEventListener("click", async () => {
            const topCard = currentGame.discardPile[currentGame.discardPile.length - 1];
            const playable = canPlayDuoCard(card, topCard, currentGame.currentColor, currentGame.hands[playerId]);

            if (!playable) return;

            if (card.type === "wild" || card.type === "draw4") {
                pendingWildCard = card;
                showColorChoice();
                return;
            }

            const playerIds = Object.keys(currentGame.hands);
            const success = playDuoCard(currentGame, playerId, card.id, playerIds, finishOrder);
            if (!success) return;

            playCardSound();
            hasDrawnThisTurn = false;

            const finishedPlayerId = playerIds.find(id => currentGame.hands[id].length === 0);
            if (finishedPlayerId && !finishOrder.includes(finishedPlayerId)) {
                finishOrder.push(finishedPlayerId);
                const activePlayerIds = playerIds.filter(id => !finishOrder.includes(id));
                const roomRef = ref(db, `rooms/${currentRoomCode}`);

                if (activePlayerIds.length === 1) {
                    finishOrder.push(activePlayerIds[0]);
                    await update(roomRef, { finishOrder: finishOrder, status: "finished" });
                } else {
                    await update(roomRef, { finishOrder: finishOrder });
                }
            }

            displayMyHand(currentGame.hands[playerId]);
            updatePlayableCards();
            displayDiscardCard(currentGame.discardPile[currentGame.discardPile.length - 1]);

            const roomRef = ref(db, `rooms/${currentRoomCode}`);
            await update(roomRef, {
                game: {
                    deck: currentGame.deck,
                    discardPile: currentGame.discardPile,
                    currentPlayer: currentGame.currentPlayer,
                    direction: currentGame.direction,
                    currentColor: currentGame.currentColor,
                    unoCalled: currentGame.unoCalled
                },
                hands: currentGame.hands
            });

            await set(ref(db, `rooms/${currentRoomCode}/game/cardPlayed`), {
                playerId: playerId,
                timestamp: Date.now()
            });
        });

        container.appendChild(cardElement);
    });
}

function updatePlayableCards() {
    const cards = document.querySelectorAll("#my-hand .card-image");
    if (!currentGame || !currentGame.discardPile) return;

    const topCard = currentGame.discardPile[currentGame.discardPile.length - 1];

    cards.forEach((cardElement, index) => {
        const card = currentGame.hands[playerId]?.[index];
        if (!card) return;

        cardElement.classList.remove("playable-card");
        cardElement.onmouseenter = null;

        if (!isDuoMyTurn(currentGame, playerId)) return;

        if (canPlayDuoCard(card, topCard, currentGame.currentColor, currentGame.hands[playerId])) {
            cardElement.classList.add("playable-card");
            cardElement.onmouseenter = playCardHoverSound;
        }
    });
}

function listenToMyHand() {
    if (!currentRoomCode || !playerId) return;
    const handRef = ref(db, `rooms/${currentRoomCode}/hands/${playerId}`);
    onValue(handRef, (snapshot) => {
        displayMyHand(snapshot.val());
    });
}

function getCardImage(card) {
    let imageFolder = "images/duo/";
    if (currentGameMode === "duo-no-mercy") imageFolder = "images/duo-no-mercy/";

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

document.getElementById("draw-card")?.addEventListener("click", async () => {
    if (!currentGame || !isDuoMyTurn(currentGame, playerId) || hasDrawnThisTurn) return;

    const card = drawDuoCard(currentGame, playerId, hasDrawnThisTurn);
    if (!card) return;

    drawnCardId = card.id;
    hasDrawnThisTurn = true;
    updateGameButtons();

    displayMyHand(currentGame.hands[playerId]);
    const roomRef = ref(db, `rooms/${currentRoomCode}`);

    await update(roomRef, {
        game: {
            deck: currentGame.deck,
            discardPile: currentGame.discardPile,
            currentPlayer: currentGame.currentPlayer,
            direction: currentGame.direction,
            currentColor: currentGame.currentColor,
            unoCalled: currentGame.unoCalled,
            unoRequired: currentGame.unoRequired
        },
        hands: currentGame.hands
    });

    playDrawSound();
});

document.getElementById("pass-turn")?.addEventListener("click", async () => {
    if (!currentGame || !isDuoMyTurn(currentGame, playerId) || !hasDrawnThisTurn) return;

    const playerIds = Object.keys(currentGame.hands);
    hasDrawnThisTurn = false;
    updateGameButtons();

    nextDuoPlayer(currentGame, playerIds, finishOrder);

    const roomRef = ref(db, `rooms/${currentRoomCode}`);
    await update(roomRef, {
        game: {
            deck: currentGame.deck,
            discardPile: currentGame.discardPile,
            currentPlayer: currentGame.currentPlayer,
            direction: currentGame.direction,
            currentColor: currentGame.currentColor,
            unoCalled: currentGame.unoCalled,
            unoRequired: currentGame.unoRequired
        },
        hands: currentGame.hands
    });
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

    if (currentGame.currentPlayer === playerId) {
        element.textContent = "🟢 C'est ton tour !";
        element.className = "my-turn";
    } else {
        element.textContent = "⏳ Ce n'est pas ton tour...";
        element.className = "other-turn";
    }
}

function updateGameButtons() {
    const drawButton = document.getElementById("draw-card");
    const passButton = document.getElementById("pass-turn");
    if (!drawButton || !passButton) return;

    if (!currentGame) {
        drawButton.disabled = true;
        passButton.disabled = true;
        return;
    }

    const myTurn = isDuoMyTurn(currentGame, playerId);
    drawButton.disabled = !myTurn || hasDrawnThisTurn;
    passButton.disabled = !myTurn || !hasDrawnThisTurn;
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

function showColorChoice() {
    const colorChoice = document.getElementById("color-choice");
    if (colorChoice) colorChoice.style.display = "flex";
}

document.querySelectorAll("#color-choice button").forEach(button => {
    button.addEventListener("click", async () => {
        const color = button.dataset.color;
        if (!pendingWildCard) return;

        const playerIds = Object.keys(currentGame.hands);
        const success = playDuoCard(currentGame, playerId, pendingWildCard.id, playerIds, finishOrder);
        if (!success) return;

        if (pendingWildCard.type === "draw4") {
            const nextPlayerId = currentGame.currentPlayer;
            for (let i = 0; i < 4; i++) {
                if (currentGame.deck.length > 0) {
                    currentGame.hands[nextPlayerId].push(currentGame.deck.pop());
                }
            }
            nextDuoPlayer(currentGame, playerIds, finishOrder);
        }

        currentGame.currentColor = color;
        pendingWildCard = null;

        document.getElementById("color-choice").style.display = "none";
        displayMyHand(currentGame.hands[playerId]);
        updatePlayableCards();
        displayDiscardCard(currentGame.discardPile[currentGame.discardPile.length - 1]);
        displayTurnInfo();
        updateGameButtons();

        const roomRef = ref(db, `rooms/${currentRoomCode}`);
        await update(roomRef, {
            game: {
                deck: currentGame.deck,
                discardPile: currentGame.discardPile,
                currentPlayer: currentGame.currentPlayer,
                direction: currentGame.direction,
                currentColor: currentGame.currentColor,
                unoCalled: currentGame.unoCalled
            },
            hands: currentGame.hands
        });
    });
});

// Événements d'interface générale
document.getElementById("choose-mode-button")?.addEventListener("click", () => {
    document.getElementById("home-screen").style.display = "none";
    document.getElementById("mode-screen").style.display = "flex";
});

document.getElementById("duo-mode-button")?.addEventListener("click", () => {
    currentGameMode = "duo";
    document.getElementById("mode-screen").style.display = "none";
    document.getElementById("connection-screen").style.display = "flex";
});

document.getElementById("no-mercy-mode-button")?.addEventListener("click", () => {
    currentGameMode = "duo-no-mercy";
    document.getElementById("mode-screen").style.display = "none";
    document.getElementById("connection-screen").style.display = "flex";
});

if(currentGameMode === "duo-no-mercy") {
    element.getElementById("current-game-mode-logo").src = "images/duo-no-mercy.webp";
}

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
        "turn-info", "draw-card", "pass-turn", "color-choice", "uno-button"
    ];

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
            if (el) el.style.display = "";
        });
    }

    if (roomStatus === "finished") {
        if (lobbyContent) lobbyContent.style.display = "none";
        if (playerNameContainer) playerNameContainer.style.display = "none";
        if (winnerMessage) winnerMessage.style.display = "flex";

        gameElements.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = "";
        });
    }
}

document.getElementById("back-home-button")?.addEventListener("click", async () => {
    const roomCode = currentRoomCode;

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
    hasDrawnThisTurn = false;
    pendingWildCard = null;
    finishOrder = [];
    hasCalledUno = false;
    drawnCardId = null;
    lastDuoAnnouncementTimestamp = null;
    lastCardPlayedTimestamp = null;
    victorySoundPlayed = false;

    const playerNameContainer = document.getElementById("player-name-container");
    const backHomeButton = document.getElementById("back-home-button");

    if (playerNameContainer) playerNameContainer.style.display = "";
    if (backHomeButton) backHomeButton.style.display = "none";

    const discardPile = document.getElementById("discard-pile");
    if (discardPile) discardPile.innerHTML = "";

    const playersList = document.getElementById("players-list");
    if (playersList) playersList.innerHTML = "";

    const winnerMessage = document.getElementById("winner-message");
    if (winnerMessage) winnerMessage.style.display = "none";

    document.body.style.setProperty("--game-start", "#6a5acd");
    document.body.style.setProperty("--game-end", "#00bcd4");
});

// Effets sonores
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

// Amis & Profil
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