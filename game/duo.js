// duo.js - Logique et règles du mode DUO

export function createDeck() {
    const deck = [];
    const colors = ["red", "blue", "green", "yellow"];

    for (const color of colors) {
        // Carte 0
        deck.push({
            id: crypto.randomUUID(),
            color: color,
            type: "number",
            value: 0
        });

        // Cartes 1 à 9
        for (let value = 1; value <= 9; value++) {
            deck.push({
                id: crypto.randomUUID(),
                color: color,
                type: "number",
                value: value
            });
            deck.push({
                id: crypto.randomUUID(),
                color: color,
                type: "number",
                value: value
            });
        }

        // +2, Skip, Reverse
        for (let i = 0; i < 2; i++) {
            deck.push({ id: crypto.randomUUID(), color: color, type: "draw2" });
            deck.push({ id: crypto.randomUUID(), color: color, type: "skip" });
            deck.push({ id: crypto.randomUUID(), color: color, type: "reverse" });
        }
    }

    // Jokers
    for (let i = 0; i < 4; i++) {
        deck.push({ id: crypto.randomUUID(), color: null, type: "wild" });
        deck.push({ id: crypto.randomUUID(), color: null, type: "draw4" });
    }

    return deck;
}

export function canPlayCard(card, topCard, currentColor, hand) {
    if (card.type === "wild") {
        return true;
    }

    if (card.type === "draw4") {
        const hasMatchingColor = hand.some(
            handCard => handCard.color === currentColor
        );
        return !hasMatchingColor;
    }

    if (card.color === currentColor) {
        return true;
    }

    if (
        card.type === "number" &&
        topCard.type === "number" &&
        card.value === topCard.value
    ) {
        return true;
    }

    if (card.type === topCard.type && card.type !== "number") {
        return true;
    }

    return false;
}

export function shuffleDeck(deck) {
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

export function recycleDiscardPile(game) {
    if (game.discardPile.length <= 1) {
        return false;
    }

    const topCard = game.discardPile[game.discardPile.length - 1];
    const recycledCards = game.discardPile.slice(0, -1);

    shuffleDeck(recycledCards);

    game.deck = recycledCards;
    game.discardPile = [topCard];

    console.log("♻️ Défausse recyclée :", game.deck.length, "cartes disponibles");
    return true;
}

export function dealCards(deck, playerIds) {
    const hands = {};
    for (const playerId of playerIds) {
        hands[playerId] = [];
    }

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

export function createGameState(playerIds) {
    const deck = shuffleDeck(createDeck());
    const result = dealCards(deck, playerIds);

    const initialCards = [];
    let firstCard = null;

    while (result.remainingDeck.length > 0) {
        const candidate = result.remainingDeck.pop();
        if (candidate.type === "number") {
            firstCard = candidate;
            break;
        }
        initialCards.push(candidate);
    }

    result.remainingDeck.push(...initialCards);
    shuffleDeck(result.remainingDeck);

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

export function isMyTurn(game, playerId) {
    return game.currentPlayer === playerId;
}

export function nextPlayer(game, playerIds, finishOrder = []) {
    const activePlayerIds = playerIds.filter(id => !finishOrder.includes(id));
    if (activePlayerIds.length <= 1) return;

    const currentIndex = activePlayerIds.indexOf(game.currentPlayer);
    let nextIndex = currentIndex + game.direction;

    if (nextIndex >= activePlayerIds.length) nextIndex = 0;
    if (nextIndex < 0) nextIndex = activePlayerIds.length - 1;

    game.currentPlayer = activePlayerIds[nextIndex];
}

export function isTwoPlayerGame(game) {
    return Object.keys(game.hands || {}).length === 2;
}

export function playCard(game, playerId, cardId, playerIds, finishOrder = []) {
    if (!isMyTurn(game, playerId)) return false;

    const hand = game.hands[playerId];
    const cardIndex = hand.findIndex(card => card.id === cardId);
    if (cardIndex === -1) return false;

    const card = hand[cardIndex];
    const topCard = game.discardPile[game.discardPile.length - 1];

    if (!canPlayCard(card, topCard, game.currentColor, hand)) {
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

    if (card.type === "reverse") {
        game.direction *= -1;
    }

    nextPlayer(game, playerIds, finishOrder);

    if (card.type === "skip" || (card.type === "reverse" && isTwoPlayerGame(game))) {
        nextPlayer(game, playerIds, finishOrder);
    }

    if (card.type === "draw2") {
        const nextPlayerId = game.currentPlayer;

        for (let i = 0; i < 2; i++) {
            if (game.deck.length === 0) recycleDiscardPile(game);
            if (game.deck.length === 0) break;

            const drawnCard = game.deck.pop();
            game.hands[nextPlayerId].push(drawnCard);
        }

        nextPlayer(game, playerIds, finishOrder);
    }

    return true;
}

export function drawCard(game, playerId, hasDrawnThisTurn) {
    if (!isMyTurn(game, playerId)) return null;
    if (hasDrawnThisTurn) return null;

    if (game.deck.length === 0) {
        const recycled = recycleDiscardPile(game);
        if (!recycled) return null;
    }

    const card = game.deck.pop();
    game.hands[playerId].push(card);

    delete game.unoCalled[playerId];
    delete game.unoRequired[playerId];

    return card;
}