// duo-no-mercy.js - Logique et règles du mode DUO NO MERCY
//
// Règles implémentées :
//  - Cumul (stack) : face à une attaque, on peut contre-attaquer avec une carte
//    de puissance égale ou supérieure, sinon on pioche tout le cumul et on passe.
//  - Pioche normale : 1 seule carte. Si aucune carte de la main n'est jouable
//    ensuite, le tour est passé automatiquement.
//  - Règle de la pitié : 25 cartes ou plus en main = éliminé.
//  - 7 : échange de main avec le joueur de son choix (facultatif).
//  - 0 : toutes les mains passent au joueur suivant (facultatif).
//  - Un +X ne peut jamais être posé sur un +Y de puissance supérieure.
//  - Cartes spéciales : +4 de couleur, Défausse Tout, Passe Tout le Monde,
//    Joker Inversion +4, Joker +6, Joker +10, Joker Roulette de Couleur
//    (c'est le JOUEUR SUIVANT qui choisit la couleur, puis pioche jusqu'à l'obtenir).

// ---------------------------------------------------------------------------
// CONFIGURATION (pratique pour ton futur "Configuration de partie")
// ---------------------------------------------------------------------------

export const RULES = {
    mercyLimit: 25,   // éliminé à partir de ce nombre de cartes
    handSize: 7,
    sevenZero: true   // règle du 7 et du 0
};

const COLORS = ["red", "blue", "green", "yellow"];

// Types de cartes :
//  number, skip, reverse, draw2, draw4_color, discard_all, skip_all
//  Jokers : draw4 (inversion +4), draw6, draw10, roulette
const WILD_TYPES = ["draw4", "draw6", "draw10", "roulette"];

const ATTACK_POWER = {
    draw2: 2,
    draw4_color: 4,
    draw4: 4,
    draw6: 6,
    draw10: 10
};

// Composition du paquet (modifiable facilement)
const DECK_COMPOSITION = {
    perColor: {
        skip: 3,
        reverse: 3,
        draw2: 2,
        draw4_color: 2,
        discard_all: 3,
        skip_all: 2
    },
    wild: {
        draw4: 4,
        draw6: 4,
        draw10: 4,
        roulette: 8
    }
};

// ---------------------------------------------------------------------------
// OUTILS DE BASE
// ---------------------------------------------------------------------------

function newCard(type, color = null, value = null) {
    const card = { id: crypto.randomUUID(), type: type, color: color };
    if (value !== null) card.value = value;
    return card;
}

export function shuffleDeck(deck) {
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

// Firebase supprime les tableaux vides et les valeurs null :
// on remet les champs manquants à leur valeur par défaut.
function normalize(game) {
    game.discardPile = game.discardPile || [];
    game.deck = game.deck || [];
    game.eliminated = game.eliminated || [];
    game.stackCount = game.stackCount || 0;
    game.unoCalled = game.unoCalled || {};
    game.unoRequired = game.unoRequired || {};
    game.hands = game.hands || {};
    game.pendingRoulette = game.pendingRoulette || null;
}

function getTopCard(game) {
    return game.discardPile[game.discardPile.length - 1];
}

// Roulette en attente : le joueur courant doit choisir une couleur
// (retourne { playerId, by } ou null)
export function getPendingRoulette(game) {
    const pending = game.pendingRoulette;
    if (pending && pending.playerId === game.currentPlayer) return pending;
    return null;
}

export function isWildCard(card) {
    return WILD_TYPES.includes(card.type);
}

export function getAttackPower(card) {
    return ATTACK_POWER[card.type] || 0;
}

export function isAttackCard(card) {
    return getAttackPower(card) > 0;
}

// Le joueur doit choisir une couleur en jouant cette carte
// (la roulette n'en a pas : c'est le joueur suivant qui choisit, voir chooseRouletteColor)
export function needsColorChoice(card) {
    return ["draw4", "draw6", "draw10"].includes(card.type);
}

// Le joueur doit choisir un adversaire en jouant cette carte (le 7)
export function needsTargetChoice(game, playerId, card, playerIds = [], finishOrder = []) {
    if (!RULES.sevenZero) return false;
    if (card.type !== "number" || card.value !== 7) return false;
    // Dernière carte de la main : le joueur gagne, pas d'échange
    if ((game.hands[playerId] || []).length <= 1) return false;
    return getActivePlayers(game, playerIds, finishOrder).length > 1;
}

// Le joueur peut choisir de faire tourner les mains ou non en jouant cette carte (le 0)
export function needsRotateChoice(game, playerId, card, playerIds = [], finishOrder = []) {
    if (!RULES.sevenZero) return false;
    if (card.type !== "number" || card.value !== 0) return false;
    if ((game.hands[playerId] || []).length <= 1) return false;
    return getActivePlayers(game, playerIds, finishOrder).length > 1;
}

// ---------------------------------------------------------------------------
// JOUEURS ACTIFS & TOURS
// ---------------------------------------------------------------------------

// Joueurs encore en jeu : pas éliminés, pas déjà arrivés au bout de leur main
export function getActivePlayers(game, playerIds = [], finishOrder = []) {
    normalize(game);
    const seats = game.order || playerIds;
    return seats.filter(id =>
        game.hands[id] &&
        !finishOrder.includes(id) &&
        !game.eliminated.includes(id)
    );
}

export function isMyTurn(game, playerId) {
    return !!game && game.currentPlayer === playerId;
}

export function nextPlayer(game, playerIds = [], finishOrder = []) {
    normalize(game);
    const seats = game.order || playerIds;
    const active = getActivePlayers(game, playerIds, finishOrder);
    if (active.length <= 1) return;

    const n = seats.length;
    let index = seats.indexOf(game.currentPlayer);
    if (index === -1) index = 0;

    for (let step = 0; step < n; step++) {
        index = (index + game.direction + n) % n;
        if (active.includes(seats[index])) {
            game.currentPlayer = seats[index];
            return;
        }
    }
}

// ---------------------------------------------------------------------------
// CRÉATION DE LA PARTIE
// ---------------------------------------------------------------------------

export function createDeck() {
    const deck = [];

    for (const color of COLORS) {
        // Cartes numérotées : deux exemplaires de 0 à 9
        for (let value = 0; value <= 9; value++) {
            deck.push(newCard("number", color, value));
            deck.push(newCard("number", color, value));
        }

        for (const [type, count] of Object.entries(DECK_COMPOSITION.perColor)) {
            for (let i = 0; i < count; i++) {
                deck.push(newCard(type, color));
            }
        }
    }

    for (const [type, count] of Object.entries(DECK_COMPOSITION.wild)) {
        for (let i = 0; i < count; i++) {
            deck.push(newCard(type, null));
        }
    }

    return deck;
}

export function createGameState(playerIds) {
    const deck = shuffleDeck(createDeck());
    const hands = {};

    for (const id of playerIds) hands[id] = [];

    for (let i = 0; i < RULES.handSize; i++) {
        for (const id of playerIds) {
            hands[id].push(deck.pop());
        }
    }

    // La première carte de la défausse est toujours une carte numérotée
    const skipped = [];
    let firstCard = null;
    while (deck.length > 0) {
        const candidate = deck.pop();
        if (candidate.type === "number") {
            firstCard = candidate;
            break;
        }
        skipped.push(candidate);
    }
    deck.push(...skipped);
    shuffleDeck(deck);

    return {
        order: [...playerIds],      // ordre des places, ne change jamais
        hands: hands,
        deck: deck,
        discardPile: [firstCard],
        currentPlayer: playerIds[0],
        direction: 1,
        currentColor: firstCard.color,
        stackCount: 0,              // cumul de cartes à piocher
        pendingRoulette: null,      // { playerId, by } quand une roulette attend sa couleur
        eliminated: [],             // joueurs éliminés (ordre d'élimination)
        unoCalled: {},
        unoRequired: {},
        lastEvent: null             // sert à afficher des animations / messages
    };
}

// Tout l'état partagé SAUF les mains (qui sont stockées dans room.hands).
// À utiliser à la place des objets écrits à la main dans script.js : sinon
// stackCount, eliminated, order... seraient perdus à chaque update Firebase.
export function getSharedState(game) {
    const { hands, ...shared } = game;
    return JSON.parse(JSON.stringify(shared));
}

// ---------------------------------------------------------------------------
// JOUABILITÉ
// ---------------------------------------------------------------------------

export function canPlayCard(card, topCard, currentColor, hand, stackCount = 0) {
    // Attaque en cours : seule une attaque de puissance >= est autorisée
    if (stackCount > 0) {
        return isAttackCard(card) && getAttackPower(card) >= getAttackPower(topCard);
    }

    // Un +X ne peut pas être posé sur un +Y plus puissant
    // (ex : +2 impossible sur un +4, mais +4, +6 et +10 restent jouables)
    if (
        isAttackCard(card) &&
        isAttackCard(topCard) &&
        getAttackPower(card) < getAttackPower(topCard)
    ) {
        return false;
    }

    // Les jokers se jouent à tout moment
    if (isWildCard(card)) return true;

    // Même couleur
    if (card.color === currentColor) return true;

    // Même valeur / même symbole
    if (card.type === "number") {
        return topCard.type === "number" && card.value === topCard.value;
    }
    return card.type === topCard.type;
}

// Version pratique qui lit tout dans l'état de la partie
export function isCardPlayable(game, playerId, card) {
    normalize(game);
    if (!isMyTurn(game, playerId)) return false;
    if (getPendingRoulette(game)) return false;
    return canPlayCard(
        card,
        getTopCard(game),
        game.currentColor,
        game.hands[playerId] || [],
        game.stackCount
    );
}

// ---------------------------------------------------------------------------
// PIOCHE, RECYCLAGE & ÉLIMINATION
// ---------------------------------------------------------------------------

function refillDeck(game) {
    if (game.discardPile.length <= 1) return false;

    const topCard = game.discardPile[game.discardPile.length - 1];
    const recycled = game.discardPile.slice(0, -1);

    game.deck = shuffleDeck(recycled);
    game.discardPile = [topCard];
    return true;
}

function drawFromDeck(game) {
    if (game.deck.length === 0) refillDeck(game);
    if (game.deck.length === 0) return null;
    return game.deck.pop();
}

function resetUnoFlags(game, playerId) {
    delete game.unoCalled[playerId];
    delete game.unoRequired[playerId];
}

// Règle de la pitié
export function isEliminationReached(game, playerId) {
    const hand = game.hands[playerId];
    return !!hand && hand.length >= RULES.mercyLimit;
}

// Élimine un joueur : ses cartes retournent dans la pioche.
// Si c'était son tour, le tour passe automatiquement au suivant.
export function eliminatePlayer(game, playerId, playerIds = [], finishOrder = []) {
    normalize(game);

    const activeBefore = getActivePlayers(game, playerIds, finishOrder);
    const index = activeBefore.indexOf(playerId);

    const cards = game.hands[playerId] || [];
    game.deck.push(...cards);
    shuffleDeck(game.deck);

    delete game.hands[playerId];
    resetUnoFlags(game, playerId);
    game.eliminated.push(playerId);

    if (game.currentPlayer === playerId) {
        const remaining = activeBefore.filter(id => id !== playerId);
        if (remaining.length > 0) {
            let next = game.direction === 1 ? index : index - 1;
            next = ((next % remaining.length) + remaining.length) % remaining.length;
            game.currentPlayer = remaining[next];
        }
    }
}

// Pioche. Deux cas :
//  1) Une attaque est en cours -> le joueur pioche tout le cumul et son tour se termine.
//  2) Sinon -> il pioche UNE seule carte. Si aucune carte de sa main n'est jouable, son
//     tour est passé automatiquement ; sinon il peut jouer une carte ou passer.
//
// Retourne null si l'action est invalide, sinon :
//  { drawn: [cartes], endsTurn: bool, eliminated: bool, canPlay: bool }
export function drawCard(game, playerId, hasDrawnThisTurn = false, playerIds = [], finishOrder = []) {
    normalize(game);
    if (!isMyTurn(game, playerId)) return null;
    if (getPendingRoulette(game)) return null;
    if (hasDrawnThisTurn) return null;

    const hand = game.hands[playerId];
    if (!hand) return null;

    const drawn = [];
    let endsTurn = false;
    let canPlay = false;

    if (game.stackCount > 0) {
        // Cas 1 : on encaisse l'attaque
        const amount = game.stackCount;
        game.stackCount = 0;

        for (let i = 0; i < amount; i++) {
            const card = drawFromDeck(game);
            if (!card) break;
            hand.push(card);
            drawn.push(card);
        }
        endsTurn = true;
    } else {
        // Cas 2 : pioche normale, UNE seule carte
        const card = drawFromDeck(game);
        if (card) {
            hand.push(card);
            drawn.push(card);
        }

        // Reste-t-il au moins une carte jouable dans la main (nouvelle carte incluse) ?
        const topCard = getTopCard(game);
        canPlay = hand.some(handCard =>
            canPlayCard(handCard, topCard, game.currentColor, hand, 0)
        );

        // Rien à jouer : le tour passe tout seul
        if (!canPlay) endsTurn = true;
    }

    resetUnoFlags(game, playerId);
    game.lastEvent = {
        type: "draw",
        playerId: playerId,
        count: drawn.length,
        timestamp: Date.now()
    };

    let eliminated = false;
    if (isEliminationReached(game, playerId)) {
        eliminatePlayer(game, playerId, playerIds, finishOrder);
        game.lastEvent = {
            type: "eliminated",
            playerId: playerId,
            timestamp: Date.now()
        };
        eliminated = true;
        endsTurn = false; // le tour a déjà été passé par eliminatePlayer
    } else if (endsTurn) {
        nextPlayer(game, playerIds, finishOrder);
    }

    return { drawn, endsTurn, eliminated, canPlay };
}

// ---------------------------------------------------------------------------
// EFFETS SPÉCIAUX
// ---------------------------------------------------------------------------

function swapHands(game, playerA, playerB) {
    const temp = game.hands[playerA];
    game.hands[playerA] = game.hands[playerB];
    game.hands[playerB] = temp;

    resetUnoFlags(game, playerA);
    resetUnoFlags(game, playerB);
}

// Règle du 0 : chaque main passe au joueur suivant, dans le sens du jeu
function rotateHands(game, activePlayers) {
    const n = activePlayers.length;
    const oldHands = activePlayers.map(id => game.hands[id]);

    activePlayers.forEach((id, i) => {
        const from = (i - game.direction + n) % n;
        game.hands[id] = oldHands[from];
        resetUnoFlags(game, id);
    });
}

// Défausse Tout : on pose toutes ses cartes de la même couleur
function discardAllOfColor(game, playerId, color) {
    const hand = game.hands[playerId];
    const removed = [];

    for (let i = hand.length - 1; i >= 0; i--) {
        if (hand[i].color === color) {
            removed.push(hand.splice(i, 1)[0]);
        }
    }

    // Les cartes défaussées vont SOUS la carte jouée, qui reste visible au sommet
    game.discardPile.splice(game.discardPile.length - 1, 0, ...removed);
    return removed.length;
}

// Roulette de couleur, 2e temps : le joueur suivant choisit une couleur,
// puis pioche jusqu'à obtenir une carte de cette couleur. Son tour est ensuite passé.
// Retourne true si le choix est valide.
export function chooseRouletteColor(game, playerId, color, playerIds = [], finishOrder = []) {
    normalize(game);

    const pending = getPendingRoulette(game);
    if (!pending || pending.playerId !== playerId) return false;
    if (!COLORS.includes(color)) return false;

    const hand = game.hands[playerId];
    if (!hand) return false;

    game.pendingRoulette = null;
    game.currentColor = color;

    let count = 0;
    while (hand.length < RULES.mercyLimit) {
        const card = drawFromDeck(game);
        if (!card) break;
        hand.push(card);
        count++;
        if (card.color === color) break;
    }

    resetUnoFlags(game, playerId);

    game.lastEvent = {
        type: "roulette_result",
        playerId: playerId,
        color: color,
        count: count,
        timestamp: Date.now()
    };

    if (isEliminationReached(game, playerId)) {
        eliminatePlayer(game, playerId, playerIds, finishOrder);
    } else {
        nextPlayer(game, playerIds, finishOrder); // son tour est passé
    }

    return true;
}

// ---------------------------------------------------------------------------
// JOUER UNE CARTE
// ---------------------------------------------------------------------------

// options.color          : couleur choisie (obligatoire pour les jokers +4 / +6 / +10)
// options.targetPlayerId : joueur avec qui échanger sa main (7). Absent = pas d'échange.
// options.rotate         : true pour faire tourner les mains (0). Absent = pas de rotation.
// Retourne true si la carte a été jouée, false sinon.
export function playCard(game, playerId, cardId, playerIds = [], finishOrder = [], options = {}) {
    normalize(game);

    if (!isMyTurn(game, playerId)) return false;
    if (getPendingRoulette(game)) return false; // une roulette attend sa couleur

    const hand = game.hands[playerId];
    if (!hand) return false;

    const cardIndex = hand.findIndex(card => card.id === cardId);
    if (cardIndex === -1) return false;

    const card = hand[cardIndex];
    const topCard = getTopCard(game);

    if (!canPlayCard(card, topCard, game.currentColor, hand, game.stackCount)) {
        return false;
    }

    // Validation des choix AVANT de modifier quoi que ce soit
    const active = getActivePlayers(game, playerIds, finishOrder);

    if (needsColorChoice(card) && !COLORS.includes(options.color)) {
        return false;
    }

    // Si c'est la dernière carte, le joueur gagne : pas d'échange ni de rotation
    const canSwap = RULES.sevenZero && active.length > 1 && hand.length > 1;
    const isSeven = canSwap && card.type === "number" && card.value === 7;
    const isZero = canSwap && card.type === "number" && card.value === 0;

    // Le 7 est facultatif : sans cible, on ne change rien. Si une cible est donnée, elle doit être valide.
    const swapTarget = isSeven ? options.targetPlayerId : null;
    if (swapTarget && (!active.includes(swapTarget) || swapTarget === playerId)) {
        return false;
    }

    // Le 0 est facultatif aussi
    const doRotate = isZero && options.rotate === true;

    // --- La carte est jouée ---
    hand.splice(cardIndex, 1);
    game.discardPile.push(card);
    if (card.color) {
        game.currentColor = card.color;
    } else if (options.color) {
        game.currentColor = options.color;
    }

    if (hand.length !== 1) resetUnoFlags(game, playerId);

    game.lastEvent = {
        type: card.type,
        playerId: playerId,
        color: game.currentColor,
        value: card.type === "number" ? card.value : null,
        timestamp: Date.now()
    };

    let advance = 1; // nombre de fois où on passe au joueur suivant

    switch (card.type) {
        case "number":
            if (swapTarget) {
                swapHands(game, playerId, swapTarget);
                game.lastEvent.targetPlayerId = swapTarget;
            } else if (doRotate) {
                rotateHands(game, active);
                game.lastEvent.rotated = true;
            }
            break;

        case "skip":
            advance = 2;
            break;

        case "skip_all":
            // Tout le monde est passé : le joueur rejoue
            // (sauf s'il n'a plus de cartes, sinon la partie resterait bloquée)
            advance = hand.length === 0 ? 1 : 0;
            break;

        case "reverse":
            game.direction *= -1;
            if (active.length === 2) advance = 2; // à deux, inversion = passe
            break;

        case "draw2":
        case "draw4_color":   // le +4 de couleur ne change PAS le sens
        case "draw6":
        case "draw10":
            game.stackCount += getAttackPower(card);
            break;

        case "draw4":         // Joker Inversion +4
            game.direction *= -1;
            game.stackCount += getAttackPower(card);
            break;

        case "discard_all":
            game.lastEvent.discarded = discardAllOfColor(game, playerId, card.color);
            break;

        case "roulette":
            // Le joueur suivant devra choisir la couleur (voir chooseRouletteColor)
            nextPlayer(game, playerIds, finishOrder);
            game.pendingRoulette = { playerId: game.currentPlayer, by: playerId };
            game.lastEvent.targetPlayerId = game.currentPlayer;
            advance = 0;
            break;
    }

    for (let i = 0; i < advance; i++) {
        nextPlayer(game, playerIds, finishOrder);
    }

    return true;
}

// ---------------------------------------------------------------------------
// FIN DE PARTIE
// ---------------------------------------------------------------------------

export function isGameOver(game, playerIds = [], finishOrder = []) {
    return getActivePlayers(game, playerIds, finishOrder).length <= 1;
}

// Classement : gagnants dans l'ordre d'arrivée, puis survivants,
// puis éliminés (le dernier éliminé est mieux classé que le premier).
export function getRanking(game, playerIds = [], finishOrder = []) {
    normalize(game);
    const seats = game.order || playerIds;
    const survivors = seats.filter(id =>
        !finishOrder.includes(id) && !game.eliminated.includes(id)
    );
    return [...finishOrder, ...survivors, ...[...game.eliminated].reverse()];
}

// Nom du fichier image d'une carte (sans le dossier ni l'extension .webp)
export function getCardImageName(card) {
    switch (card.type) {
        case "number":      return `${card.color}-${card.value}`;
        case "skip":        return `${card.color}-skip`;
        case "reverse":     return `${card.color}-reverse`;
        case "draw2":       return `${card.color}-draw2`;
        case "draw4_color": return `${card.color}-draw4`;
        case "discard_all": return `${card.color}-discard-all`;
        case "skip_all":    return `${card.color}-skip-all`;
        case "draw4":       return "draw4";
        case "draw6":       return "draw6";
        case "draw10":      return "draw10";
        case "roulette":    return "roulette";
        default:            return null;
    }
}