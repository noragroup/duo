// duo-no-mercy.js - Logique spécifique au mode DUO NO MERCY

export function createDeck() {
    const colors = ["red", "blue", "green", "yellow"];
    const deck = [];
    let cardId = 1;

    colors.forEach(color => {
        // Cartes numérotées (0 à 9)
        for (let i = 0; i <= 9; i++) {
            deck.push({ id: cardId++, type: "number", color: color, value: i });
            if (i !== 0) {
                deck.push({ id: cardId++, type: "number", color: color, value: i });
            }
        }

        // Cartes d'action de couleur (x2)
        for (let i = 0; i < 2; i++) {
            deck.push({ id: cardId++, type: "skip", color: color });
            deck.push({ id: cardId++, type: "reverse", color: color });
            deck.push({ id: cardId++, type: "draw2", color: color });
            // +4 de couleur (ne fait PAS reverse)
            deck.push({ id: cardId++, type: "draw4_color", color: color });
        }
    });

    // Cartes No Mercy spéciales (Jokers d'attaque uniquement, pas de Wild simple)
    for (let i = 0; i < 4; i++) {
        deck.push({ id: cardId++, type: "draw4", color: null });
        deck.push({ id: cardId++, type: "draw6", color: null });
        deck.push({ id: cardId++, type: "draw10", color: null });
    }

    return shuffle(deck);
}

function shuffle(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

export function createGameState(playerIds) {
    const deck = createDeck();
    const hands = {};

    playerIds.forEach(id => {
        hands[id] = [];
        for (let i = 0; i < 7; i++) {
            hands[id].push(deck.pop());
        }
    });

    let firstCard = deck.pop();
    while (
        firstCard.type === "draw4" ||
        firstCard.type === "draw6" ||
        firstCard.type === "draw10" ||
        firstCard.type === "draw4_color"
    ) {
        deck.unshift(firstCard);
        firstCard = deck.pop();
    }

    return {
        deck: deck,
        discardPile: [firstCard],
        hands: hands,
        currentPlayer: playerIds[0],
        direction: 1,
        currentColor: firstCard.color,
        stackCount: 0, // Cumul de cartes à piocher (+2, +4, +6, +10)
        unoCalled: {},
        unoRequired: {}
    };
}

export function canPlayCard(card, topCard, currentColor, playerHand, stackCount = 0) {
    // Si un cumul d'attaque est en cours, on ne peut jouer qu'une carte d'attaque équivalente ou supérieure
    if (stackCount > 0) {
        return getAttackPower(card) >= getAttackPower(topCard);
    }

    // Jokers d'attaque (se jouent n'importe quand hors cumul restriction)
    if (card.type === "draw4" || card.type === "draw6" || card.type === "draw10") {
        return true;
    }

    // Cartes de couleur
    if (card.color === currentColor) {
        return true;
    }

    // Cartes par symbole/valeur
    if (card.type === topCard.type) {
        if (card.type === "number") return card.value === topCard.value;
        return true;
    }

    return false;
}

function getAttackPower(card) {
    if (card.type === "draw2") return 2;
    if (card.type === "draw4" || card.type === "draw4_color") return 4;
    if (card.type === "draw6") return 6;
    if (card.type === "draw10") return 10;
    return 0;
}

export function playCard(gameState, playerId, cardId, playerIds, finishOrder = []) {
    const hand = gameState.hands[playerId];
    const cardIndex = hand.findIndex(c => c.id === cardId);

    if (cardIndex === -1) return false;

    const card = hand[cardIndex];
    const topCard = gameState.discardPile[gameState.discardPile.length - 1];

    if (!canPlayCard(card, topCard, gameState.currentColor, hand, gameState.stackCount)) {
        return false;
    }

    // Retirer la carte de la main
    hand.splice(cardIndex, 1);
    gameState.discardPile.push(card);

    // Mettre à jour la couleur courante
    if (card.color) {
        gameState.currentColor = card.color;
    }

    // Gestion du cumul d'attaques
    const attackPower = getAttackPower(card);
    if (attackPower > 0) {
        gameState.stackCount += attackPower;
    }

    // Effets des cartes spéciales
    if (card.type === "skip") {
        nextPlayer(gameState, playerIds, finishOrder);
    } else if (card.type === "reverse") {
        gameState.direction *= -1;
    }

    // Passer au joueur suivant si ce n'est pas un Joker nécessitant un choix de couleur
    if (card.type !== "draw4" && card.type !== "draw6" && card.type !== "draw10") {
        nextPlayer(gameState, playerIds, finishOrder);
    }

    return true;
}

export function drawCard(gameState, playerId, hasDrawnThisTurn = false) {
    if (hasDrawnThisTurn) return null;

    // Si le joueur piochait sous le coup d'une attaque (cumul)
    if (gameState.stackCount > 0) {
        const amountToDraw = gameState.stackCount;
        gameState.stackCount = 0; // Réinitialiser le cumul

        for (let i = 0; i < amountToDraw; i++) {
            if (gameState.deck.length === 0) refillDeck(gameState);
            if (gameState.deck.length > 0) {
                gameState.hands[playerId].push(gameState.deck.pop());
            }
        }

        checkMercyRule(gameState, playerId);
        return null;
    }

    // Pioche normale d'une seule carte
    if (gameState.deck.length === 0) refillDeck(gameState);
    if (gameState.deck.length === 0) return null;

    const drawnCard = gameState.deck.pop();
    gameState.hands[playerId].push(drawnCard);

    checkMercyRule(gameState, playerId);
    return drawnCard;
}

// Règle No Mercy : élimination si 25 cartes ou plus dans la main
export function checkMercyRule(gameState, playerId) {
    if (gameState.hands[playerId] && gameState.hands[playerId].length >= 25) {
        delete gameState.hands[playerId];
        delete gameState.unoCalled[playerId];
        delete gameState.unoRequired[playerId];
    }
}

function refillDeck(gameState) {
    if (gameState.discardPile.length <= 1) return;
    const topCard = gameState.discardPile.pop();
    gameState.deck = shuffle(gameState.discardPile);
    gameState.discardPile = [topCard];
}

export function nextPlayer(gameState, playerIds, finishOrder = []) {
    const activePlayers = playerIds.filter(id => gameState.hands[id] && !finishOrder.includes(id));
    if (activePlayers.length <= 1) return;

    let currentIndex = activePlayers.indexOf(gameState.currentPlayer);
    if (currentIndex === -1) currentIndex = 0;

    let nextIndex = (currentIndex + gameState.direction) % activePlayers.length;
    if (nextIndex < 0) nextIndex += activePlayers.length;

    gameState.currentPlayer = activePlayers[nextIndex];
}

export function isMyTurn(gameState, playerId) {
    return gameState && gameState.currentPlayer === playerId;
}