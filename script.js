let playerId = null;
let currentRoomCode = null;
let currentGame = null;
let currentGameMode = null;
let hasDrawnThisTurn = false;
let pendingWildCard = null;
let finishOrder = [];
let hasCalledUno = false;
let drawnCardId = null;
let lastDuoAnnouncementTimestamp = null;
let lastCardPlayedTimestamp = null;
let victorySoundPlayed = false;

console.log("🏁 Classement initial :", finishOrder);

import { initializeApp } from
    "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";

import {
    getDatabase,
    ref,
    set,
    update,
    onValue,
    get,
    onDisconnect,
    runTransaction
} from
    "https://www.gstatic.com/firebasejs/12.0.0/firebase-database.js";

import {
    createDeck as createDuoDeck,
    canPlayCard as canPlayDuoCard
} from "./game/duo.js";

document
    .getElementById("start-game")
    .addEventListener(
        "click",
        startGame
    );

document
    .getElementById("restart-game")
    .addEventListener(
        "click",
        startGame
    );

// For Firebase JS SDK v7.20.0 and later, measurementId is optional
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


const testRef = ref(db, "test");

set(testRef, {
    message: "Bonjour depuis mon jeu UNO !",
    timestamp: Date.now()
});

const messageRef = ref(db, "test/message");

onValue(messageRef, (snapshot) => {

    const message = snapshot.val();

    console.log("Message reçu :", message);

    document.getElementById("status").textContent = message;
});

function generateRoomCode() {

    const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

    let code = "";

    for (let i = 0; i < 6; i++) {
        code += characters[
            Math.floor(Math.random() * characters.length)
        ];
    }

    return code;
}
console.log(generateRoomCode());

async function createRoom() {
    if (!playerId) {
        alert("Connexion à Firebase en cours...");
        return;
    }

    const playerName =
        document.getElementById("player-name").value.trim();

    if (!playerName) {
        document.getElementById("player-name-message").textContent =
            "Entre ton pseudo pour continuer.";
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
            [playerId]: {
                name: playerName,
                joinedAt: Date.now()
            }
        }

    });

    const playerRef = ref(
        db,
        `rooms/${roomCode}/players/${playerId}`
    );

    onDisconnect(playerRef).remove();

    currentRoomCode = roomCode;

    document.getElementById("connection-screen").style.display = "none";
    document.getElementById("game-interface").style.display = "block";

    document.getElementById("room-info").textContent =
        `Salon : ${roomCode}`;

    console.log("Salon créé :", roomCode);

    listenToRoom(roomCode);
}

signInAnonymously(auth)
    .then((userCredential) => {

        playerId = userCredential.user.uid;

        console.log("Connecté anonymement !");
        console.log("Mon UID :", playerId);

        document.getElementById("status").textContent =
            "Connecté à Firebase";

    })
    .catch((error) => {

        console.error(
            "Erreur de connexion :",
            error
        );

        document.getElementById("status").textContent =
            "Erreur de connexion";

    });

console.log("Mon ID :", playerId);

async function joinRoom() {
    if (!playerId) {
        alert("Connexion à Firebase en cours...");
        return;
    }

    const playerName =
        document.getElementById("player-name").value.trim();

    const roomCode =
        document.getElementById("room-code").value
            .trim()
            .toUpperCase();

    if (!playerName) {
        document.getElementById("player-name-message").textContent =
            "Entre ton pseudo pour continuer.";
        return;
    }

    document.getElementById("player-name-message").textContent = "";

    if (!roomCode) {
        document.getElementById("room-code-message").textContent =
            "Entre le code du salon pour continuer.";
        return;
    }

    document.getElementById("room-code-message").textContent = "";

    const playerRef = ref(
        db,
        `rooms/${roomCode}/players/${playerId}`
    );

    await set(playerRef, {
        name: playerName,
        joinedAt: Date.now()
    });

    onDisconnect(playerRef).remove();

    currentRoomCode = roomCode;

    document.getElementById("connection-screen").style.display = "none";
    document.getElementById("game-interface").style.display = "block";

    document.getElementById("room-info").textContent =
        `Salon : ${roomCode}`;

    console.log("Salon rejoint :", roomCode);

    listenToRoom(roomCode);
}

function checkMissedUno() {
    if (!currentGame) return [];

    const missedPlayers = [];

    const required = currentGame.unoRequired || {};
    const called = currentGame.unoCalled || {};

    for (const playerId in required) {
        if (required[playerId] === true && called[playerId] !== true) {
            missedPlayers.push(playerId);
        }
    }

    return missedPlayers;
}

function checkDraw4Validity() {
    if (!currentGame) return false;

    const playerId = currentGame.lastDraw4Player;
    const previousColor = currentGame.draw4PreviousColor;

    if (!playerId || !previousColor) {
        return false;
    }

    const hand = currentGame.hands[playerId];

    if (!hand) {
        return false;
    }

    const hasMatchingColor = hand.some(
        card => card.color === previousColor
    );

    return !hasMatchingColor;
}

function applyUnoPenalty(playerId) {
    if (!currentGame) return;

    const hand = currentGame.hands[playerId];

    if (!hand) return;

    for (let i = 0; i < 2; i++) {
        if (currentGame.deck.length === 0) {
            break;
        }

        const penaltyCard = currentGame.deck.pop();

        hand.push(penaltyCard);
    }

    console.log(
        "⚠️ Pénalité UNO appliquée à :",
        playerId
    );
}

function listenToRoom() {
    if (!currentRoomCode) return;

    const roomRef = ref(db, `rooms/${currentRoomCode}`);

    onValue(roomRef, async (snapshot) => {
        const room = snapshot.val();

        const statusElement =
            document.getElementById("status");

        if (room.status === "waiting") {
            statusElement.textContent =
                "🟢 En attente de joueurs...";
        }

        if (room.status === "playing") {
            statusElement.textContent =
                "🎮 Partie en cours !";
        }

        if (room.status === "finished") {
            statusElement.textContent =
                "🏆 Partie terminée !";
        }

        if (!room) {
            console.log("❌ Salon introuvable");
            return;
        }

        // ==============================
        // Synchroniser le classement
        // ==============================

        if (room.finishOrder) {
            finishOrder = room.finishOrder;
        } else {
            finishOrder = [];
        }

        console.log("🏆 Classement synchronisé :", finishOrder);

        // ==============================
        // Partie terminée
        // ==============================

        if (room.status === "finished") {
            console.log("🏆 Partie terminée !");
            console.log("🏆 Classement final :", finishOrder);

            displayFinalRanking(room);
        }

        // ==============================
        // Affichage des joueurs
        // ==============================

        // ==============================
        // Vérifier si l'hôte est encore présent
        // ==============================

        const playerIds = Object.keys(room.players || {});

        if (
            room.hostId &&
            !room.players?.[room.hostId] &&
            playerIds.length > 0
        ) {
            const newHostId = playerIds[0];

            console.log(
                "👑 L'ancien hôte a quitté."
            );

            console.log(
                "👑 Nouvel hôte :",
                newHostId
            );

            await update(roomRef, {
                hostId: newHostId
            });

            return;
        }

        displayPlayers(room.players, room.hostId);
        updateHostUI(room.hostId);
        updateGameInterface(room.status);

        listenToMyHand();

        // ==============================
        // Synchronisation du jeu
        // ==============================

        if (room.game) {
            const duoAnnouncement =
                room.game.duoAnnouncement;

            const cardPlayed =
                room.game.cardPlayed;

            if (
                cardPlayed &&
                cardPlayed.timestamp !== lastCardPlayedTimestamp
            ) {
                lastCardPlayedTimestamp =
                    cardPlayed.timestamp;

                // Le joueur qui a posé la carte
                // a déjà joué le son localement.
                if (cardPlayed.playerId !== playerId) {
                    playCardSound();
                }
            }

            if (
                duoAnnouncement &&
                duoAnnouncement.timestamp !== lastDuoAnnouncementTimestamp
            ) {
                lastDuoAnnouncementTimestamp =
                    duoAnnouncement.timestamp;

                const duoAnnouncementElement =
                    document.getElementById("duo-announcement");

                const duoPlayerName =
                    document.getElementById("duo-player-name");

                if (duoAnnouncementElement) {

                    if (duoPlayerName) {
                        duoPlayerName.textContent =
                            duoAnnouncement.playerName;
                    }

                    duoAnnouncementElement.classList.remove("show");

                    void duoAnnouncementElement.offsetWidth;

                    duoAnnouncementElement.classList.add("show");

                    playDuoSound();
                }
            }

            console.log("🔥 Game reçu de Firebase :", room.game);

            currentGame = {
                ...room.game,
                hands: room.hands,
                unoCalled: room.game.unoCalled || {},
                unoRequired: room.game.unoRequired || {},
                lastDraw4Player: room.game.lastDraw4Player || null,
                draw4PreviousColor: room.game.draw4PreviousColor || null,
                draw4TargetPlayer: room.game.draw4TargetPlayer || null
            };

            if (
                currentGame.hands &&
                currentGame.hands[playerId]
            ) {
                displayMyHand(
                    currentGame.hands[playerId]
                );
            }

            // ==============================
            // Détection des joueurs ayant 1 carte
            // ==============================

            const playerIds = Object.keys(currentGame.hands || {});

            for (const id of playerIds) {
                const hand = currentGame.hands[id];

                if (hand && hand.length === 1) {
                    const unoRequiredRef = ref(
                        db,
                        `rooms/${currentRoomCode}/game/unoRequired/${id}`
                    );

                    await set(unoRequiredRef, true);
                }
            }

            // ==============================
            // Détection des joueurs ayant quitté
            // ==============================

            const currentPlayerIds = Object.keys(room.players || {});
            const gamePlayerIds = Object.keys(currentGame.hands || {});

            const leftPlayers = gamePlayerIds.filter(
                id => !currentPlayerIds.includes(id)
            );

            if (leftPlayers.length > 0) {
                console.log(
                    "👋 Joueur(s) ayant quitté :",
                    leftPlayers
                );

                // Retirer les joueurs de la partie
                for (const leftPlayerId of leftPlayers) {
                    delete currentGame.hands[leftPlayerId];
                    delete currentGame.unoCalled[leftPlayerId];
                    delete currentGame.unoRequired[leftPlayerId];
                }

                const remainingPlayerIds =
                    Object.keys(currentGame.hands);

                console.log(
                    "👥 Joueurs restants :",
                    remainingPlayerIds
                );

                // ==============================
                // Il ne reste qu'un joueur
                // ==============================

                if (remainingPlayerIds.length === 1) {
                    const lastPlayerId =
                        remainingPlayerIds[0];

                    console.log(
                        "🏁 Il ne reste qu'un joueur :",
                        lastPlayerId
                    );

                    await update(roomRef, {
                        status: "finished",
                        hands: currentGame.hands,
                        game: {
                            ...room.game,
                            currentPlayer: lastPlayerId,
                            unoCalled: currentGame.unoCalled,
                            unoRequired: currentGame.unoRequired
                        }
                    });

                    return;
                }

                // ==============================
                // Le joueur qui a quitté avait le tour
                // ==============================

                if (
                    leftPlayers.includes(
                        currentGame.currentPlayer
                    ) &&
                    remainingPlayerIds.length > 1
                ) {
                    nextPlayer(
                        currentGame,
                        remainingPlayerIds,
                        finishOrder
                    );

                    console.log(
                        "➡️ Tour transféré à :",
                        currentGame.currentPlayer
                    );
                }

                // ==============================
                // Enregistrer le nouvel état
                // ==============================

                await update(roomRef, {
                    hands: currentGame.hands,
                    game: {
                        ...room.game,
                        currentPlayer:
                            currentGame.currentPlayer,
                        unoCalled:
                            currentGame.unoCalled,
                        unoRequired:
                            currentGame.unoRequired
                    }
                });

                console.log(
                    "🔥 Départ du joueur enregistré dans Firebase !"
                );
            }

            // ==============================
            // Affichage du jeu
            // ==============================

            console.log("Jeu actuel :", currentGame);

            displayTurnInfo();
            updateGameButtons();
            updatePlayableCards();
            updateUnoButton();
            displayPlayers(room.players, room.hostId);
            updateBackgroundColor();
        }

        // ==============================
        // Afficher la carte sur la table
        // ==============================

        if (
            room.game &&
            room.game.discardPile
        ) {
            const topCard =
                room.game.discardPile[
                room.game.discardPile.length - 1
                ];

            displayDiscardCard(topCard);
        }
    });
}

function displayPlayers(players, hostId) {

    const list =
        document.getElementById("players-list");

    list.innerHTML = "";

    if (!players) {
        return;
    }

    Object.entries(players).forEach(
        ([id, player]) => {

            const li = document.createElement("li");

            if (
                currentGame &&
                currentGame.currentPlayer === id
            ) {
                li.classList.add("current-player");
            }

            let prefix = "";

            if (id === hostId) {
                prefix = "👑 ";
            }

            if (
                currentGame &&
                currentGame.currentPlayer === id
            ) {
                prefix += "🟢 ";
            }

            let cardCount = "";

            if (
                currentGame &&
                currentGame.hands &&
                currentGame.hands[id]
            ) {
                cardCount =
                    ` — ${currentGame.hands[id].length} carte(s)`;
            }

            li.textContent =
                `${prefix}${player.name}${cardCount}`;

            list.appendChild(li);
        }
    );
}

function displayFinalRanking(room) {

    const winnerMessage =
        document.getElementById("winner-message");

    const finalRanking =
        document.getElementById("final-ranking");

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

    ranking.forEach((playerId, index) => {

        const player = players[playerId];

        if (!player) return;

        let medal = "";

        if (index === 0) {

            medal = "🥇";

        } else if (index === 1) {

            medal = "🥈";

        } else if (index === 2) {

            medal = "🥉";

        } else {

            medal = `${index + 1}.`;

        }

        html += `<p>${medal} ${player.name}</p>`;

    });

    finalRanking.innerHTML = html;

    const restartButton =
        document.getElementById("restart-game");

    if (restartButton) {

        if (room.hostId === playerId) {
            restartButton.style.display = "block";
        } else {
            restartButton.style.display = "none";
        }

    }

    winnerMessage.style.display = "flex";
}

import {
    getAuth,
    signInAnonymously
} from
    "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";

function updateHostUI(hostId) {

    const button =
        document.getElementById("start-game");

    if (!button) return;

    if (
        currentGame &&
        currentGame.currentPlayer
    ) {
        button.style.display = "none";
        return;
    }

    if (hostId === playerId) {
        button.style.display = "block";
    } else {
        button.style.display = "none";
    }

}

async function startGame() {
    victorySoundPlayed = false;
    if (!currentRoomCode) return;
    if (!playerId) return;

    const roomRef = ref(db, `rooms/${currentRoomCode}`);

    const snapshot = await get(roomRef);
    const room = snapshot.val();

    if (!room) {
        console.log("Salon introuvable");
        return;
    }

    if (room.hostId !== playerId) {
        console.log("Seul l'hôte peut lancer la partie");
        return;
    }

    const playerIds = getPlayerIds(room.players);

    console.log("Joueurs de la partie :", playerIds);

    const game = createGameState(playerIds);

    finishOrder = [];

    console.log("🎨 Game avant Firebase :", game);
    console.log("Partie créée :", game);

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
        unoRequired: {},
        lastDraw4Player: null,
        draw4PreviousColor: null,
        draw4TargetPlayer: null
    };

    displayMyHand(game.hands[playerId]);

    displayDiscardCard(
        game.discardPile[
        game.discardPile.length - 1
        ]
    );

    displayTurnInfo();
    updateGameButtons();
    updatePlayableCards();
    updateUnoButton();
    updateBackgroundColor();

    console.log("Partie enregistrée dans Firebase !");
}

function shuffleDeck(deck) {

    for (let i = deck.length - 1; i > 0; i--) {

        const j = Math.floor(
            Math.random() * (i + 1)
        );

        [deck[i], deck[j]] =
            [deck[j], deck[i]];
    }

    return deck;
}

function recycleDiscardPile(game) {
    // Il faut au moins la carte du dessus
    // + une carte à recycler.
    if (game.discardPile.length <= 1) {
        return false;
    }

    // On garde la carte visible du dessus.
    const topCard =
        game.discardPile[game.discardPile.length - 1];

    // Toutes les autres cartes deviennent
    // la nouvelle pioche.
    const recycledCards =
        game.discardPile.slice(0, -1);

    // On mélange les cartes recyclées.
    shuffleDeck(recycledCards);

    // Nouvelle pioche.
    game.deck = recycledCards;

    // On garde uniquement la carte du dessus
    // dans la défausse.
    game.discardPile = [topCard];

    console.log(
        "♻️ Défausse recyclée :",
        game.deck.length,
        "cartes disponibles"
    );

    return true;
}

function dealCards(deck, playerIds) {
    const hands = {};

    // Créer une main vide pour chaque joueur
    for (const playerId of playerIds) {
        hands[playerId] = [];
    }

    // Distribuer 7 cartes à chaque joueur
    for (let i = 0; i < 7; i++) {
        for (const playerId of playerIds) {
            hands[playerId].push(deck.pop());
        }
    }

    return {
        hands: hands,
        remainingDeck: deck
    };
}

function createGameState(playerIds) {
    const deck = shuffleDeck(createDuoDeck());
    const result = dealCards(deck, playerIds);

    console.log("🎨 Game créé :", {
        currentColor: null
    });

    const firstCard = result.remainingDeck.pop();

    return {
        hands: result.hands,
        deck: result.remainingDeck,
        discardPile: [firstCard],
        currentPlayer: playerIds[0],
        direction: 1,
        currentColor: firstCard.color,
        unoCalled: {},
        unoRequired: {},
        lastDraw4Player: null,
        draw4PreviousColor: null,
        draw4TargetPlayer: null
    };
}

function isMyTurn(game, playerId) {
    return game.currentPlayer === playerId;
}

function nextPlayer(game, playerIds, finishOrder = []) {
    const activePlayerIds = playerIds.filter(
        id => !finishOrder.includes(id)
    );

    if (activePlayerIds.length <= 1) {
        return;
    }

    const currentIndex = activePlayerIds.indexOf(
        game.currentPlayer
    );

    let nextIndex = currentIndex + game.direction;

    if (nextIndex >= activePlayerIds.length) {
        nextIndex = 0;
    }

    if (nextIndex < 0) {
        nextIndex = activePlayerIds.length - 1;
    }

    game.currentPlayer = activePlayerIds[nextIndex];
}

function isTwoPlayerGame(game) {
    return Object.keys(game.hands || {}).length === 2;
}

async function playCard(game, playerId, cardId, playerIds) {
    // Vérifier que c'est bien le tour du joueur
    if (!isMyTurn(game, playerId)) {
        return false;
    }

    const hand = game.hands[playerId];

    // Chercher la carte dans la main
    const cardIndex = hand.findIndex(card => card.id === cardId);

    // Carte introuvable
    if (cardIndex === -1) {
        return false;
    }

    const card = hand[cardIndex];

    // Carte actuellement au sommet de la défausse
    const topCard = game.discardPile[game.discardPile.length - 1];

    // Vérifier si la carte peut être jouée
    if (!canPlayDuoCard(
        card,
        topCard,
        game.currentColor,
        hand
    )) {
        return false;
    }

    hand.splice(cardIndex, 1);
    game.discardPile.push(card);

    if (hand.length !== 1) {
        delete game.unoRequired[playerId];
        delete game.unoCalled[playerId];
    }

    if (card.color) {
        game.currentColor = card.color;
    }

    if (card.type === "draw4") {

        game.lastDraw4Player = playerId;

        game.draw4PreviousColor = game.currentColor;

        game.draw4TargetPlayer = game.currentPlayer;

    }

    if (card.type === "draw4") {
        console.log(
            "🧪 +4 valide ?",
            checkDraw4Validity()
        );
    }

    if (card.type === "reverse") {
        game.direction *= -1;
    }

    nextPlayer(game, playerIds, finishOrder);

    if (
        card.type === "skip" ||
        (card.type === "reverse" && isTwoPlayerGame(game))
    ) {
        nextPlayer(game, playerIds, finishOrder);
    }

    if (card.type === "draw2") {
        const nextPlayerId = game.currentPlayer;

        for (let i = 0; i < 4; i++) {
            if (currentGame.deck.length > 0) {
                const drawnCard = currentGame.deck.pop();
                currentGame.hands[nextPlayerId].push(drawnCard);
            }
        }

        console.log("➕4 : 4 cartes ajoutées à la main du joueur ciblé");

        nextPlayer(
            currentGame,
            playerIds,
            finishOrder
        );

        console.log(
            "➕4 : nouveau joueur :",
            currentGame.currentPlayer
        );
    }

    const missedUnoPlayers = checkMissedUno();

    if (missedUnoPlayers.length > 0) {
        console.log(
            "⚠️ Joueurs ayant oublié UNO :",
            missedUnoPlayers
        );

        for (const missedPlayerId of missedUnoPlayers) {
            applyUnoPenalty(missedPlayerId);

            // Le joueur a été traité :
            // on retire l'obligation UNO
            delete currentGame.unoRequired[missedPlayerId];

            // On nettoie aussi une éventuelle ancienne annonce
            delete currentGame.unoCalled[missedPlayerId];
        }

        const roomRef = ref(
            db,
            `rooms/${currentRoomCode}`
        );

        await update(roomRef, {
            game: {
                deck: currentGame.deck,
                discardPile: currentGame.discardPile,
                currentPlayer: currentGame.currentPlayer,
                direction: currentGame.direction,
                currentColor: currentGame.currentColor,
                unoCalled: currentGame.unoCalled,
                unoRequired: currentGame.unoRequired,
                lastDraw4Player: currentGame.lastDraw4Player,
                draw4PreviousColor: currentGame.draw4PreviousColor
            },
            hands: currentGame.hands
        });

        console.log("🔥 Pénalités UNO enregistrées dans Firebase !");
    }

    return true;
}

function drawCard(game, playerId) {
    if (!isMyTurn(currentGame, playerId)) {
        console.log("❌ Ce n'est pas ton tour");
        return;
    }

    if (hasDrawnThisTurn) {
        console.log("❌ Tu as déjà pioché ce tour");
        return;
    }

    // Si la pioche est vide, on recycle la défausse.
    if (game.deck.length === 0) {
        const recycled = recycleDiscardPile(game);

        if (!recycled) {
            console.log("❌ Impossible de recycler la défausse");
            return false;
        }
    }

    const card = game.deck.pop();

    game.hands[playerId].push(card);

    delete game.unoCalled[playerId];
    delete game.unoRequired[playerId];

    return card;
}

function getPlayerIds(players) {
    if (!players) {
        return [];
    }

    return Object.keys(players);
}

async function testReadOtherHand(roomCode, otherPlayerId) {
    const otherHandRef = ref(
        db,
        `rooms/${roomCode}/hands/${otherPlayerId}`
    );

    try {
        const snapshot = await get(otherHandRef);

        console.log("Main récupérée :", snapshot.val());
    } catch (error) {
        console.error("Lecture refusée :", error);
    }
}

window.testReadOtherHand = testReadOtherHand;

async function testMyHand() {
    const handRef = ref(
        db,
        `rooms/${currentRoomCode}/hands/${playerId}`
    );

    const snapshot = await get(handRef);

    console.log("Ma main :", snapshot.val());
}

window.testMyHand = testMyHand;

function playDuoSound() {

    const AudioContext =
        window.AudioContext || window.webkitAudioContext;

    if (!AudioContext) return;

    const audioContext = new AudioContext();

    const oscillator =
        audioContext.createOscillator();

    const gain =
        audioContext.createGain();

    oscillator.type = "sine";

    oscillator.frequency.setValueAtTime(
        520,
        audioContext.currentTime
    );

    oscillator.frequency.exponentialRampToValueAtTime(
        820,
        audioContext.currentTime + 0.15
    );

    gain.gain.setValueAtTime(
        0.001,
        audioContext.currentTime
    );

    gain.gain.exponentialRampToValueAtTime(
        0.25,
        audioContext.currentTime + 0.02
    );

    gain.gain.exponentialRampToValueAtTime(
        0.001,
        audioContext.currentTime + 0.35
    );

    oscillator.connect(gain);
    gain.connect(audioContext.destination);

    oscillator.start();

    oscillator.stop(
        audioContext.currentTime + 0.35
    );
}

function playCardSound() {

    const AudioContext =
        window.AudioContext || window.webkitAudioContext;

    if (!AudioContext) return;

    const audioContext = new AudioContext();

    const now = audioContext.currentTime;

    // Petit "clac" de carte
    const oscillator =
        audioContext.createOscillator();

    const gain =
        audioContext.createGain();

    oscillator.type = "square";

    oscillator.frequency.setValueAtTime(
        180,
        now
    );

    oscillator.frequency.exponentialRampToValueAtTime(
        90,
        now + 0.08
    );

    gain.gain.setValueAtTime(
        0.001,
        now
    );

    gain.gain.exponentialRampToValueAtTime(
        0.22,
        now + 0.005
    );

    gain.gain.exponentialRampToValueAtTime(
        0.001,
        now + 0.09
    );

    oscillator.connect(gain);
    gain.connect(audioContext.destination);

    oscillator.start(now);

    oscillator.stop(now + 0.09);

    // Petit bruit sec pour donner une sensation de carte
    const buffer =
        audioContext.createBuffer(
            1,
            audioContext.sampleRate * 0.06,
            audioContext.sampleRate
        );

    const data =
        buffer.getChannelData(0);

    for (let i = 0; i < data.length; i++) {
        data[i] =
            (Math.random() * 2 - 1) *
            (1 - i / data.length);
    }

    const noise =
        audioContext.createBufferSource();

    const noiseGain =
        audioContext.createGain();

    noise.buffer = buffer;

    noiseGain.gain.setValueAtTime(
        0.001,
        now
    );

    noiseGain.gain.exponentialRampToValueAtTime(
        0.12,
        now + 0.003
    );

    noiseGain.gain.exponentialRampToValueAtTime(
        0.001,
        now + 0.06
    );

    noise.connect(noiseGain);
    noiseGain.connect(audioContext.destination);

    noise.start(now);
}

function playDrawSound() {

    const AudioContext =
        window.AudioContext || window.webkitAudioContext;

    if (!AudioContext) return;

    const audioContext = new AudioContext();

    const now = audioContext.currentTime;

    // Petit bruit de glissement
    const buffer =
        audioContext.createBuffer(
            1,
            audioContext.sampleRate * 0.12,
            audioContext.sampleRate
        );

    const data =
        buffer.getChannelData(0);

    for (let i = 0; i < data.length; i++) {

        const progress =
            i / data.length;

        data[i] =
            (Math.random() * 2 - 1) *
            (1 - progress) *
            0.8;
    }

    const noise =
        audioContext.createBufferSource();

    const filter =
        audioContext.createBiquadFilter();

    const gain =
        audioContext.createGain();

    noise.buffer = buffer;

    filter.type = "highpass";

    filter.frequency.setValueAtTime(
        700,
        now
    );

    filter.frequency.exponentialRampToValueAtTime(
        1800,
        now + 0.12
    );

    gain.gain.setValueAtTime(
        0.001,
        now
    );

    gain.gain.exponentialRampToValueAtTime(
        0.16,
        now + 0.015
    );

    gain.gain.exponentialRampToValueAtTime(
        0.001,
        now + 0.12
    );

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(audioContext.destination);

    noise.start(now);
}

function playCardHoverSound() {

    const AudioContext =
        window.AudioContext || window.webkitAudioContext;

    if (!AudioContext) return;

    const audioContext = new AudioContext();

    const now = audioContext.currentTime;

    const oscillator =
        audioContext.createOscillator();

    const gain =
        audioContext.createGain();

    oscillator.type = "sine";

    oscillator.frequency.setValueAtTime(
        320,
        now
    );

    oscillator.frequency.exponentialRampToValueAtTime(
        520,
        now + 0.06
    );

    gain.gain.setValueAtTime(
        0.001,
        now
    );

    gain.gain.exponentialRampToValueAtTime(
        0.06,
        now + 0.01
    );

    gain.gain.exponentialRampToValueAtTime(
        0.001,
        now + 0.07
    );

    oscillator.connect(gain);
    gain.connect(audioContext.destination);

    oscillator.start(now);

    oscillator.stop(now + 0.07);
}

function playVictorySound() {

    const AudioContext =
        window.AudioContext || window.webkitAudioContext;

    if (!AudioContext) return;

    const audioContext = new AudioContext();

    const now = audioContext.currentTime;

    const notes = [
        { frequency: 523.25, time: 0 },
        { frequency: 659.25, time: 0.12 },
        { frequency: 783.99, time: 0.24 },
        { frequency: 1046.50, time: 0.38 }
    ];

    notes.forEach(note => {

        const oscillator =
            audioContext.createOscillator();

        const gain =
            audioContext.createGain();

        oscillator.type = "triangle";

        oscillator.frequency.setValueAtTime(
            note.frequency,
            now + note.time
        );

        gain.gain.setValueAtTime(
            0.001,
            now + note.time
        );

        gain.gain.exponentialRampToValueAtTime(
            0.18,
            now + note.time + 0.02
        );

        gain.gain.exponentialRampToValueAtTime(
            0.001,
            now + note.time + 0.35
        );

        oscillator.connect(gain);
        gain.connect(audioContext.destination);

        oscillator.start(
            now + note.time
        );

        oscillator.stop(
            now + note.time + 0.35
        );

    });
}

function displayMyHand(hand) {

    const container = document.getElementById("my-hand");

    const title = document.getElementById("my-hand-title");

    container.innerHTML = "";

    if (!hand) {

        if (title) {

            title.textContent = "Ma main";

        }

        return;
    }

    if (title) {

        const count = hand.length;

        title.textContent =
            `Ma main — ${count} carte${count > 1 ? "s" : ""}`;
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

        const topCard =
            currentGame.discardPile[
            currentGame.discardPile.length - 1
            ];

        cardElement.addEventListener("click", async () => {

            console.log("🖱️ CLIC SUR LA CARTE");

            console.log("currentGame :", currentGame);

            console.log("Carte cliquée :", card);

            const topCard =
                currentGame.discardPile[
                currentGame.discardPile.length - 1
                ];

            const playable = canPlayDuoCard(
                card,
                topCard,
                currentGame.currentColor,
                currentGame.hands[playerId]
            );

            console.log(
                playable
                    ? "✅ Carte jouable"
                    : "❌ Carte non jouable"
            );

            if (!playable) {

                return;

            }

            console.log("Mon UID :", playerId);

            console.log(
                "Joueur actuel :",
                currentGame.currentPlayer
            );

            console.log(
                "Est-ce mon tour ?",
                isMyTurn(currentGame, playerId)
            );

            if (card.type === "wild" || card.type === "draw4") {

                pendingWildCard = card;

                console.log(
                    "🃏 Carte spéciale en attente de couleur :",
                    card
                );

                showColorChoice();

                return;
            }

            const playerIds =
                Object.keys(currentGame.hands);

            const success = await playCard(
                currentGame,
                playerId,
                card.id,
                playerIds
            );

            console.log(
                "Résultat de playCard() :",
                success
            );

            if (!success) return;

            playCardSound();

            hasDrawnThisTurn = false;

            const finishedPlayerId = playerIds.find(
                id => currentGame.hands[id].length === 0
            );

            if (
                finishedPlayerId &&
                !finishOrder.includes(finishedPlayerId)
            ) {

                finishOrder.push(finishedPlayerId);

                const activePlayerIds =
                    getActivePlayerIds(
                        currentGame,
                        finishOrder
                    );

                console.log(
                    "🏁 Joueur ayant terminé :",
                    finishedPlayerId
                );

                console.log(
                    "🏆 Classement actuel :",
                    finishOrder
                );

                console.log(
                    "👥 Joueurs encore en jeu :",
                    activePlayerIds
                );

                const roomRef = ref(
                    db,
                    `rooms/${currentRoomCode}`
                );

                // S'il reste un seul joueur,
                // il prend automatiquement la dernière place

                if (activePlayerIds.length === 1) {

                    const lastPlayerId =
                        activePlayerIds[0];

                    finishOrder.push(lastPlayerId);

                    console.log(
                        "🏁 Dernier joueur :",
                        lastPlayerId
                    );

                    console.log(
                        "🏆 Classement final :",
                        finishOrder
                    );

                    await update(roomRef, {

                        finishOrder: finishOrder,

                        status: "finished"

                    });

                } else {

                    await update(roomRef, {

                        finishOrder: finishOrder

                    });

                }
            }

            console.log("✅ Carte jouée :", card);

            console.log(
                "Nouvelle défausse :",
                currentGame.discardPile
            );

            displayMyHand(
                currentGame.hands[playerId]
            );

            updatePlayableCards();

            const newTopCard =
                currentGame.discardPile[
                currentGame.discardPile.length - 1
                ];

            displayDiscardCard(newTopCard);

            console.log(
                "📤 État à envoyer à Firebase :",
                currentGame
            );

            const roomRef = ref(
                db,
                `rooms/${currentRoomCode}`
            );

            await update(roomRef, {

                game: {

                    deck: currentGame.deck,

                    discardPile:
                        currentGame.discardPile,

                    currentPlayer:
                        currentGame.currentPlayer,

                    direction:
                        currentGame.direction,

                    currentColor:
                        currentGame.currentColor,

                    unoCalled:
                        currentGame.unoCalled

                },

                hands: currentGame.hands

            });

            const cardPlayedRef = ref(
                db,
                `rooms/${currentRoomCode}/game/cardPlayed`
            );

            await set(cardPlayedRef, {
                playerId: playerId,
                timestamp: Date.now()
            });

            console.log(
                "🔥 Coup enregistré dans Firebase !"
            );

        });

        container.appendChild(cardElement);

    });

}

function updatePlayableCards() {

    const cards =
        document.querySelectorAll("#my-hand .card-image");

    if (!currentGame || !currentGame.discardPile) {
        return;
    }

    const topCard =
        currentGame.discardPile[
        currentGame.discardPile.length - 1
        ];

    cards.forEach((cardElement, index) => {

        const card =
            currentGame.hands[playerId][index];

        cardElement.classList.remove(
            "playable-card"
        );

        cardElement.onmouseenter = null;

        if (!isMyTurn(currentGame, playerId)) {
            return;
        }

        if (
            canPlayDuoCard(
                card,
                topCard,
                currentGame.currentColor,
                currentGame.hands[playerId]
            )
        ) {

            cardElement.classList.add(
                "playable-card"
            );

            cardElement.onmouseenter =
                playCardHoverSound;
        }

    });
}

function listenToMyHand() {
    if (!currentRoomCode || !playerId) {
        return;
    }

    const handRef = ref(
        db,
        `rooms/${currentRoomCode}/hands/${playerId}`
    );

    onValue(handRef, (snapshot) => {
        const hand = snapshot.val();

        displayMyHand(hand);
    });
}

function getCardImage(card) {

    let imageFolder = "images/duo/";

    if (currentGameMode === "duo-no-mercy") {
        imageFolder = "images/duo-no-mercy/";
    }

    if (card.type === "number") {
        return `${imageFolder}${card.color}-${card.value}.svg`;
    }

    if (card.type === "skip") {
        return `${imageFolder}${card.color}-skip.svg`;
    }

    if (card.type === "reverse") {
        return `${imageFolder}${card.color}-reverse.svg`;
    }

    if (card.type === "draw2") {
        return `${imageFolder}${card.color}-draw2.svg`;
    }

    if (card.type === "wild") {
        return `${imageFolder}wild.svg`;
    }

    if (card.type === "draw4") {
        return `${imageFolder}draw4.svg`;
    }

    return null;
}

function displayDiscardCard(card) {
    const container = document.getElementById("discard-pile");

    container.innerHTML = "";

    if (!card) {
        return;
    }

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

    if (
        currentGame &&
        currentGame.currentColor === "red"
    ) {
        startColor = "#b71c1c";
        endColor = "#ef5350";
    }

    if (
        currentGame &&
        currentGame.currentColor === "blue"
    ) {
        startColor = "#2196f3";
        endColor = "#64b5f6";
    }

    if (
        currentGame &&
        currentGame.currentColor === "green"
    ) {
        startColor = "#43a047";
        endColor = "#81c784";
    }

    if (
        currentGame &&
        currentGame.currentColor === "yellow"
    ) {
        startColor = "#d4a017";
        endColor = "#f6d365";
    }

    document.body.style.setProperty(
        "--game-start",
        startColor
    );

    document.body.style.setProperty(
        "--game-end",
        endColor
    );
}

document.getElementById("draw-card").addEventListener("click", async () => {
    console.log("🃏 Bouton piocher cliqué");

    if (!currentGame) {
        return;
    }

    if (!isMyTurn(currentGame, playerId)) {
        console.log("❌ Ce n'est pas ton tour");
        return;
    }

    if (hasDrawnThisTurn) {
        console.log("❌ Tu as déjà pioché ce tour");
        return;
    }

    const card = drawCard(currentGame, playerId);

    if (!card) {

        console.log("❌ Impossible de piocher");

        return;

    }

    drawnCardId = card.id;

    hasDrawnThisTurn = true;
    updateGameButtons();

    console.log("✅ Carte piochée :", card);

    displayMyHand(currentGame.hands[playerId]);

    const roomRef = ref(
        db,
        `rooms/${currentRoomCode}`
    );

    await update(roomRef, {
        game: {
            deck: currentGame.deck,
            discardPile: currentGame.discardPile,
            currentPlayer: currentGame.currentPlayer,
            direction: currentGame.direction,
            currentColor: currentGame.currentColor,
            unoCalled: currentGame.unoCalled,
            unoRequired: currentGame.unoRequired,
            lastDraw4Player: currentGame.lastDraw4Player,
            draw4PreviousColor: currentGame.draw4PreviousColor,
            draw4TargetPlayer: currentGame.draw4TargetPlayer
        },
        hands: currentGame.hands
    });


    playDrawSound();

    console.log("🔥 Pioche enregistrée dans Firebase !");
});

document.getElementById("pass-turn").addEventListener("click", async () => {
    console.log("⏭️ Bouton passer le tour cliqué");

    if (!currentGame) {
        return;
    }

    if (!isMyTurn(currentGame, playerId)) {
        console.log("❌ Ce n'est pas ton tour");
        return;
    }

    if (!hasDrawnThisTurn) {
        console.log("❌ Tu dois d'abord piocher");
        return;
    }

    const playerIds = Object.keys(currentGame.hands);

    hasDrawnThisTurn = false;
    updateGameButtons();

    nextPlayer(
        currentGame,
        playerIds,
        finishOrder
    );

    console.log(
        "➡️ Nouveau joueur :",
        currentGame.currentPlayer
    );

    const roomRef = ref(
        db,
        `rooms/${currentRoomCode}`
    );

    await update(roomRef, {
        game: {
            deck: currentGame.deck,
            discardPile: currentGame.discardPile,
            currentPlayer: currentGame.currentPlayer,
            direction: currentGame.direction,
            currentColor: currentGame.currentColor,
            unoCalled: currentGame.unoCalled,
            unoRequired: currentGame.unoRequired,
            lastDraw4Player: currentGame.lastDraw4Player,
            draw4PreviousColor: currentGame.draw4PreviousColor,
            draw4TargetPlayer: currentGame.draw4TargetPlayer
        },
        hands: currentGame.hands
    });

    console.log("🔥 Tour passé et enregistré dans Firebase !");
});

document.getElementById("uno-button").addEventListener("click", async () => {
    console.log("🗣️ DUO !");

    hasCalledUno = true;

    const duoAnnouncement =
        document.getElementById("duo-announcement");

    const duoPlayerName =
        document.getElementById("duo-player-name");

    if (duoAnnouncement) {

        if (duoPlayerName) {

            const playerName =
                document.getElementById("player-name").value.trim();

            duoPlayerName.textContent =
                playerName || "Joueur";

        }

        duoAnnouncement.classList.remove("show");

        void duoAnnouncement.offsetWidth;

        duoAnnouncement.classList.add("show");

    }

    const unoButton = document.getElementById("uno-button");
    unoButton.style.display = "none";

    const unoRef = ref(
        db,
        `rooms/${currentRoomCode}/game/unoCalled/${playerId}`
    );

    await set(unoRef, true);

    playDuoSound();

    console.log("✅ DUO enregistré dans Firebase !");

    const duoAnnouncementRef = ref(
        db,
        `rooms/${currentRoomCode}/game/duoAnnouncement`
    );

    await set(duoAnnouncementRef, {
        playerId: playerId,
        playerName:
            document.getElementById("player-name").value.trim() || "Joueur",
        timestamp: Date.now()
    });
});

function displayTurnInfo() {

    const element = document.getElementById("turn-info");

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

    if (!currentGame) {
        drawButton.disabled = true;
        passButton.disabled = true;
        return;
    }

    const myTurn = isMyTurn(currentGame, playerId);

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

    const unoRequired =
        currentGame.unoRequired &&
        currentGame.unoRequired[playerId] === true;

    const unoCalled =
        currentGame.unoCalled &&
        currentGame.unoCalled[playerId] === true;

    // Le bouton n'apparaît que si UNO est requis
    // et que ce joueur ne l'a pas encore annoncé.
    if (unoRequired && !unoCalled) {
        unoButton.style.display = "block";
    } else {
        unoButton.style.display = "none";
    }
}

function showColorChoice() {

    const colorChoice =
        document.getElementById("color-choice");

    if (!colorChoice) return;

    colorChoice.style.display = "flex";

}

console.log("🎨 Fonction showColorChoice prête");

document.querySelectorAll("#color-choice button").forEach(button => {
    button.addEventListener("click", async () => {
        const color = button.dataset.color;

        console.log("🎨 Couleur choisie :", color);

        if (!pendingWildCard) {
            console.log("❌ Aucun Joker en attente");
            return;
        }

        const playerIds = Object.keys(currentGame.hands);

        const success = await playCard(
            currentGame,
            playerId,
            pendingWildCard.id,
            playerIds
        );

        if (!success) {
            console.log("❌ Impossible de jouer le Joker");
            return;
        }

        if (pendingWildCard.type === "draw4") {
            const nextPlayerId = currentGame.currentPlayer;

            console.log("➕4 : joueur ciblé :", nextPlayerId);

            for (let i = 0; i < 4; i++) {
                if (currentGame.deck.length > 0) {
                    const drawnCard = currentGame.deck.pop();
                    currentGame.hands[nextPlayerId].push(drawnCard);
                }
            }

            console.log("➕4 : 4 cartes ajoutées à la main du joueur ciblé");

            nextPlayer(currentGame, playerIds);

            console.log(
                "➕4 : nouveau joueur :",
                currentGame.currentPlayer
            );
        }

        currentGame.currentColor = color;

        pendingWildCard = null;

        document.getElementById("color-choice").style.display = "none";

        displayMyHand(currentGame.hands[playerId]);
        updatePlayableCards();

        const newTopCard =
            currentGame.discardPile[
            currentGame.discardPile.length - 1
            ];

        displayDiscardCard(newTopCard);
        displayTurnInfo();
        updateGameButtons();

        const roomRef = ref(
            db,
            `rooms/${currentRoomCode}`
        );

        await update(roomRef, {
            game: {
                deck: currentGame.deck,
                discardPile: currentGame.discardPile,
                currentPlayer: currentGame.currentPlayer,
                direction: currentGame.direction,
                currentColor: currentGame.currentColor,
                unoCalled: currentGame.unoCalled,
                unoRequired: currentGame.unoRequired,
                lastDraw4Player: currentGame.lastDraw4Player,
                draw4PreviousColor: currentGame.draw4PreviousColor,
                draw4TargetPlayer: currentGame.draw4TargetPlayer
            },
            hands: currentGame.hands
        });

        console.log("🔥 Joker joué et couleur enregistrée :", color);
    });
});

function getActivePlayerIds(game, finishOrder) {
    const allPlayerIds = Object.keys(game.hands);

    return allPlayerIds.filter(
        id => !finishOrder.includes(id)
    );
}

document
    .getElementById("choose-mode-button")
    .addEventListener("click", () => {
        document.getElementById("home-screen").style.display = "none";
        document.getElementById("mode-screen").style.display = "flex";
    });

document
    .getElementById("duo-mode-button")
    .addEventListener("click", () => {

        currentGameMode = "duo";

        console.log("🎮 Mode sélectionné :", currentGameMode);

        document.getElementById("mode-screen").style.display = "none";
        document.getElementById("connection-screen").style.display = "flex";
    });

document
    .getElementById("host-game-button")
    .addEventListener("click", async () => {

        const playerName =
            document.getElementById("player-name").value.trim();

        if (!playerName) {
            document.getElementById("player-name-message").textContent =
                "Entre ton pseudo pour continuer.";
            return;
        }

        document.getElementById("player-name-message").textContent = "";

        await createRoom();

    });

document
    .getElementById("confirm-join-room")
    .addEventListener("click", async () => {

        const playerName =
            document.getElementById("player-name").value.trim();

        if (!playerName) {
            document.getElementById("player-name-message").textContent =
                "Entre ton pseudo pour continuer.";
            return;
        }

        document.getElementById("player-name-message").textContent = "";
        document.getElementById("room-code-message").textContent = "";

        await joinRoom();

    });

function updateGameInterface(roomStatus) {

    const lobbyContent =
        document.getElementById("lobby-content");

    const playerNameContainer =
        document.getElementById("player-name-container");

    const winnerMessage =
        document.getElementById("winner-message");

    const gameElements = [
        "my-hand-title",
        "my-hand",
        "discard-section",
        "turn-info",
        "draw-card",
        "pass-turn",
        "color-choice",
        "uno-button"
    ];

    if (roomStatus === "waiting") {

        if (lobbyContent) {
            lobbyContent.style.display = "";
        }

        if (playerNameContainer) {
            playerNameContainer.style.display = "";
        }

        if (winnerMessage) {
            winnerMessage.style.display = "none";
        }

        gameElements.forEach(id => {

            const element =
                document.getElementById(id);

            if (!element) return;

            element.style.display = "none";

        });
    }

    if (roomStatus === "playing") {

        if (lobbyContent) {
            lobbyContent.style.display = "none";
        }

        if (playerNameContainer) {
            playerNameContainer.style.display = "none";
        }

        if (winnerMessage) {
            winnerMessage.style.display = "none";
        }

        gameElements.forEach(id => {

            const element =
                document.getElementById(id);

            if (!element) return;

            element.style.display = "";

        });
    }

    if (roomStatus === "finished") {

        if (lobbyContent) {
            lobbyContent.style.display = "none";
        }

        if (playerNameContainer) {
            playerNameContainer.style.display = "none";
        }

        if (winnerMessage) {
            winnerMessage.style.display = "flex";
        }

        gameElements.forEach(id => {

            const element =
                document.getElementById(id);

            if (!element) return;

            element.style.display = "";

        });
    }
}

document
    .getElementById("back-home-button")
    .addEventListener("click", async () => {

        const roomCode = currentRoomCode;

        // Retour immédiat à l'accueil
        document.getElementById("game-interface").style.display =
            "none";

        document.getElementById("home-screen").style.display =
            "flex";

        document.getElementById("mode-screen").style.display =
            "none";

        document.getElementById("connection-screen").style.display =
            "none";

        if (roomCode && playerId) {

            const roomRef = ref(
                db,
                `rooms/${roomCode}`
            );

            await runTransaction(
                roomRef,
                room => {

                    if (!room) {
                        return;
                    }

                    const players =
                        room.players || {};

                    const playerIds =
                        Object.keys(players);

                    // Dernier joueur :
                    // suppression complète du salon
                    if (
                        playerIds.length === 1 &&
                        playerIds[0] === playerId
                    ) {

                        console.log(
                            "🗑️ Dernier joueur : suppression du salon"
                        );

                        return null;
                    }

                    // Plusieurs joueurs :
                    // on retire uniquement le joueur actuel
                    delete players[playerId];

                    room.players = players;

                    return room;
                }
            );

            console.log(
                "👋 Départ du salon effectué"
            );
        }

        // Nettoyage de l'état local
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

        console.log(
            "🏠 Retour à l'accueil"
        );
    });