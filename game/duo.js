export function createDeck() {

    const deck = [];

    const colors = [
        "red",
        "blue",
        "green",
        "yellow"
    ];

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

        // +2
        for (let i = 0; i < 2; i++) {

            deck.push({
                id: crypto.randomUUID(),
                color: color,
                type: "draw2"
            });

        }

        // Skip
        for (let i = 0; i < 2; i++) {

            deck.push({
                id: crypto.randomUUID(),
                color: color,
                type: "skip"
            });

        }

        // Reverse
        for (let i = 0; i < 2; i++) {

            deck.push({
                id: crypto.randomUUID(),
                color: color,
                type: "reverse"
            });

        }
    }

    // Jokers
    for (let i = 0; i < 4; i++) {

        deck.push({
            id: crypto.randomUUID(),
            color: null,
            type: "wild"
        });

        deck.push({
            id: crypto.randomUUID(),
            color: null,
            type: "draw4"
        });
    }

    return deck;
}

export function canPlayCard(card, topCard, currentColor, hand) {

    if (card.type === "wild") {
        return true;
    }

    if (card.type === "draw4") {

        // Le +4 est interdit si le joueur possède
        // une carte de la couleur actuelle.

        const hasMatchingColor = hand.some(
            handCard =>
                handCard.color === currentColor
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

    if (
        card.type === topCard.type &&
        card.type !== "number"
    ) {
        return true;
    }

    return false;
}