// achievements.js - Succès (logique pure : pas de Firebase, pas de DOM)
//
// - Les succès se débloquent automatiquement en jouant : progress.js évalue la
//   liste ci-dessous après chaque action qui pourrait en compléter un (fin de
//   partie, achat en boutique, ami ajouté, compte créé...).
// - Chaque succès rapporte de l'EXP et des points DUO, selon son "tier" (sa
//   difficulté) — voir TIERS. Pas besoin de choisir des valeurs à la main pour
//   chaque succès : il suffit de choisir le bon tier.
// - Pour ajouter un succès : ajoute une entrée dans ACHIEVEMENTS avec une
//   fonction check(stats) qui renvoie true une fois la condition remplie.
//   "stats" est construit par buildStats() ci-dessous à partir de la
//   progression Firebase du joueur (voir le détail juste avant ACHIEVEMENTS).

import { SKINS } from "./skins.js";
import { getLevelFromExp, applyExpGain } from "./levels.js";

// ---------------------------------------------------------------------------
// PALIERS DE RÉCOMPENSE (difficulté -> EXP + points DUO)
// ---------------------------------------------------------------------------

export const TIERS = {
    bronze: { label: "Bronze", icon: "🥉", exp: 50, points: 5 },
    silver: { label: "Argent", icon: "🥈", exp: 120, points: 12 },
    gold: { label: "Or", icon: "🥇", exp: 250, points: 25 },
    platinum: { label: "Platine", icon: "💠", exp: 500, points: 50 },
    legendary: { label: "Légendaire", icon: "👑", exp: 1000, points: 100 }
};

export function getTier(tierId) {
    return TIERS[tierId] || TIERS.bronze;
}

// Catégories, dans l'ordre d'affichage du menu
export const ACHIEVEMENT_CATEGORIES = [
    { id: "general", name: "Général", icon: "🌟" },
    { id: "duo", name: "DUO", icon: "🎴" },
    { id: "duo-no-mercy", name: "DUO No Mercy", icon: "😈" }
];

function totalSkinsForDeck(deckId) {
    return SKINS.filter(skin => skin.deck === deckId).length;
}

const DEFAULT_MODE_STATS = { played: 0, won: 0, maxPlayersWon: 0, survived: 0, maxEliminationsInWin: 0 };

// Stats vierges (voir aussi createEmptyProgress() dans levels.js, qui s'en sert)
export function createEmptyStats() {
    return {
        byMode: {
            duo: { ...DEFAULT_MODE_STATS },
            "duo-no-mercy": { ...DEFAULT_MODE_STATS }
        },
        winStreak: 0,
        bestWinStreak: 0,
        friendsCount: 0,
        accountLinked: false
    };
}

export function cloneModeStats(raw) {
    return { ...DEFAULT_MODE_STATS, ...(raw || {}) };
}

// Construit l'objet "stats" utilisé par les check() des succès, à partir
// de la progression Firebase (progress.exp, progress.unlockedSkins, progress.stats...)
export function buildStats(progress) {
    const stats = progress?.stats || {};
    const unlockedSkins = progress?.unlockedSkins || {};

    const ownedSkinsByDeck = {};
    let ownedSkinsCount = 0;
    let ownsShopSkin = false;

    SKINS.forEach(skin => {
        const owned = skin.unlock === "default" || !!unlockedSkins[skin.id];
        if (owned) {
            ownedSkinsCount++;
            ownedSkinsByDeck[skin.deck] = (ownedSkinsByDeck[skin.deck] || 0) + 1;
            if (skin.unlock === "shop") ownsShopSkin = true;
        }
    });

    return {
        gamesPlayed: progress?.gamesPlayed || 0,
        gamesWon: progress?.gamesWon || 0,
        level: getLevelFromExp(progress?.exp || 0),
        friendsCount: stats.friendsCount || 0,
        accountLinked: !!stats.accountLinked,
        bestWinStreak: stats.bestWinStreak || 0,
        byMode: {
            duo: cloneModeStats(stats.byMode?.duo),
            "duo-no-mercy": cloneModeStats(stats.byMode?.["duo-no-mercy"])
        },
        ownedSkinsCount,
        ownedSkinsByDeck,
        ownsShopSkin
    };
}

// ---------------------------------------------------------------------------
// CATALOGUE DES SUCCÈS
// ---------------------------------------------------------------------------
//  id          : identifiant unique (sert à la sauvegarde)
//  category    : "general" | "duo" | "duo-no-mercy"
//  tier        : voir TIERS (détermine l'EXP et les points gagnés)
//  icon, name, description : affichés dans le menu
//  check(stats): renvoie true quand le succès doit être débloqué
//  progress(stats) (optionnel) : { current, target } pour une barre de progression

export const ACHIEVEMENTS = [
    // ----- Général -----
    {
        id: "first-game", category: "general", tier: "bronze", icon: "🎴",
        name: "Premiers pas", description: "Termine ta première partie, DUO ou No Mercy.",
        check: stats => stats.gamesPlayed >= 1,
        progress: stats => ({ current: stats.gamesPlayed, target: 1 })
    },
    {
        id: "games-10", category: "general", tier: "bronze", icon: "🎴",
        name: "Habitué", description: "Termine 10 parties.",
        check: stats => stats.gamesPlayed >= 10,
        progress: stats => ({ current: stats.gamesPlayed, target: 10 })
    },
    {
        id: "games-50", category: "general", tier: "silver", icon: "🎴",
        name: "Vétéran", description: "Termine 50 parties.",
        check: stats => stats.gamesPlayed >= 50,
        progress: stats => ({ current: stats.gamesPlayed, target: 50 })
    },
    {
        id: "games-100", category: "general", tier: "gold", icon: "🎴",
        name: "Centurion", description: "Termine 100 parties.",
        check: stats => stats.gamesPlayed >= 100,
        progress: stats => ({ current: stats.gamesPlayed, target: 100 })
    },
    {
        id: "first-win", category: "general", tier: "bronze", icon: "🏆",
        name: "Première victoire", description: "Gagne ta première partie.",
        check: stats => stats.gamesWon >= 1,
        progress: stats => ({ current: stats.gamesWon, target: 1 })
    },
    {
        id: "win-streak-3", category: "general", tier: "silver", icon: "🔥",
        name: "Série gagnante", description: "Gagne 3 parties d'affilée.",
        check: stats => stats.bestWinStreak >= 3,
        progress: stats => ({ current: stats.bestWinStreak, target: 3 })
    },
    {
        id: "win-streak-5", category: "general", tier: "gold", icon: "🔥",
        name: "Série légendaire", description: "Gagne 5 parties d'affilée.",
        check: stats => stats.bestWinStreak >= 5,
        progress: stats => ({ current: stats.bestWinStreak, target: 5 })
    },
    {
        id: "both-modes", category: "general", tier: "silver", icon: "🎭",
        name: "Polyvalent", description: "Gagne au moins une partie en DUO et une en DUO No Mercy.",
        check: stats => stats.byMode.duo.won >= 1 && stats.byMode["duo-no-mercy"].won >= 1
    },
    {
        id: "friends-3", category: "general", tier: "bronze", icon: "👥",
        name: "Sociable", description: "Ajoute 3 amis.",
        check: stats => stats.friendsCount >= 3,
        progress: stats => ({ current: stats.friendsCount, target: 3 })
    },
    {
        id: "friends-10", category: "general", tier: "silver", icon: "👥",
        name: "Pilier de la communauté", description: "Ajoute 10 amis.",
        check: stats => stats.friendsCount >= 10,
        progress: stats => ({ current: stats.friendsCount, target: 10 })
    },
    {
        id: "account-linked", category: "general", tier: "silver", icon: "🔐",
        name: "Compte sécurisé", description: "Crée un compte pour sauvegarder ta progression.",
        check: stats => stats.accountLinked
    },
    {
        id: "shop-purchase", category: "general", tier: "bronze", icon: "🛒",
        name: "Petit investisseur", description: "Achète un article dans la boutique.",
        check: stats => stats.ownsShopSkin
    },
    {
        id: "level-10", category: "general", tier: "gold", icon: "⭐",
        name: "Grand joueur", description: "Atteins le niveau 10.",
        check: stats => stats.level >= 10,
        progress: stats => ({ current: stats.level, target: 10 })
    },
    {
        id: "level-20", category: "general", tier: "platinum", icon: "⭐",
        name: "Expert DUO", description: "Atteins le niveau 20.",
        check: stats => stats.level >= 20,
        progress: stats => ({ current: stats.level, target: 20 })
    },
    {
        id: "skins-5", category: "general", tier: "silver", icon: "🎨",
        name: "Styliste", description: "Possède 5 skins différents.",
        check: stats => stats.ownedSkinsCount >= 5,
        progress: stats => ({ current: stats.ownedSkinsCount, target: 5 })
    },
    {
        id: "skins-all-duo", category: "general", tier: "gold", icon: "👗",
        name: "Garde-robe DUO complète", description: "Possède tous les skins du paquet DUO.",
        check: stats => (stats.ownedSkinsByDeck.duo || 0) >= totalSkinsForDeck("duo"),
        progress: stats => ({ current: stats.ownedSkinsByDeck.duo || 0, target: totalSkinsForDeck("duo") })
    },
    {
        id: "skins-all-no-mercy", category: "general", tier: "gold", icon: "👗",
        name: "Garde-robe No Mercy complète", description: "Possède tous les skins du paquet DUO No Mercy.",
        check: stats => (stats.ownedSkinsByDeck["duo-no-mercy"] || 0) >= totalSkinsForDeck("duo-no-mercy"),
        progress: stats => ({ current: stats.ownedSkinsByDeck["duo-no-mercy"] || 0, target: totalSkinsForDeck("duo-no-mercy") })
    },

    // ----- DUO -----
    {
        id: "duo-win", category: "duo", tier: "bronze", icon: "🎴",
        name: "Première victoire DUO", description: "Gagne une partie en DUO.",
        check: stats => stats.byMode.duo.won >= 1
    },
    {
        id: "duo-win-4p", category: "duo", tier: "silver", icon: "👨‍👩‍👧‍👦",
        name: "Quatuor de choc", description: "Gagne une partie DUO à 4 joueurs ou plus.",
        check: stats => stats.byMode.duo.maxPlayersWon >= 4
    },
    {
        id: "duo-wins-10", category: "duo", tier: "silver", icon: "🏅",
        name: "Habitué du DUO", description: "Gagne 10 parties en DUO.",
        check: stats => stats.byMode.duo.won >= 10,
        progress: stats => ({ current: stats.byMode.duo.won, target: 10 })
    },
    {
        id: "duo-wins-50", category: "duo", tier: "gold", icon: "🏅",
        name: "Maître du DUO", description: "Gagne 50 parties en DUO.",
        check: stats => stats.byMode.duo.won >= 50,
        progress: stats => ({ current: stats.byMode.duo.won, target: 50 })
    },

    // ----- DUO No Mercy -----
    {
        id: "no-mercy-win", category: "duo-no-mercy", tier: "bronze", icon: "😈",
        name: "Première victoire No Mercy", description: "Gagne une partie en DUO No Mercy.",
        check: stats => stats.byMode["duo-no-mercy"].won >= 1
    },
    {
        id: "no-mercy-survivor", category: "duo-no-mercy", tier: "bronze", icon: "🛡️",
        name: "Survivant", description: "Termine une partie No Mercy sans être éliminé.",
        check: stats => stats.byMode["duo-no-mercy"].survived >= 1
    },
    {
        id: "no-mercy-ruthless", category: "duo-no-mercy", tier: "gold", icon: "💀",
        name: "Dernier debout", description: "Gagne une partie où au moins 3 adversaires ont été éliminés.",
        check: stats => stats.byMode["duo-no-mercy"].maxEliminationsInWin >= 3
    },
    {
        id: "no-mercy-wins-10", category: "duo-no-mercy", tier: "silver", icon: "🏅",
        name: "Impitoyable", description: "Gagne 10 parties en No Mercy.",
        check: stats => stats.byMode["duo-no-mercy"].won >= 10,
        progress: stats => ({ current: stats.byMode["duo-no-mercy"].won, target: 10 })
    },
    {
        id: "no-mercy-wins-50", category: "duo-no-mercy", tier: "gold", icon: "🏅",
        name: "Bourreau", description: "Gagne 50 parties en No Mercy.",
        check: stats => stats.byMode["duo-no-mercy"].won >= 50,
        progress: stats => ({ current: stats.byMode["duo-no-mercy"].won, target: 50 })
    }
];

export function getAchievementById(id) {
    return ACHIEVEMENTS.find(achievement => achievement.id === id) || null;
}

export function getAchievementsByCategory(categoryId) {
    return ACHIEVEMENTS.filter(achievement => achievement.category === categoryId);
}

// ---------------------------------------------------------------------------
// ÉVALUATION
// ---------------------------------------------------------------------------

// Succès nouvellement complétés (non encore marqués dans unlockedAchievements)
export function evaluateAchievements(progress) {
    const stats = buildStats(progress);
    const unlocked = progress?.unlockedAchievements || {};

    const newlyUnlocked = [];
    let expGained = 0;
    let pointsGained = 0;

    for (const achievement of ACHIEVEMENTS) {
        if (unlocked[achievement.id]) continue;
        if (!achievement.check(stats)) continue;

        const tier = getTier(achievement.tier);
        newlyUnlocked.push({
            id: achievement.id,
            name: achievement.name,
            icon: achievement.icon,
            tier: achievement.tier,
            exp: tier.exp,
            points: tier.points
        });
        expGained += tier.exp;
        pointsGained += tier.points;
    }

    return { newlyUnlocked, expGained, pointsGained };
}

// Marque les succès nouvellement complétés comme débloqués (ne touche pas à l'EXP :
// voir applyAchievementUnlocksWithExp ci-dessous pour la version complète).
// Fonction pure : retourne { progress, newlyUnlocked, expGained, pointsGained }.
export function applyAchievementUnlocks(currentProgress) {
    const progress = {
        ...currentProgress,
        unlockedAchievements: { ...(currentProgress?.unlockedAchievements || {}) }
    };

    const { newlyUnlocked, expGained, pointsGained } = evaluateAchievements(progress);
    newlyUnlocked.forEach(achievement => { progress.unlockedAchievements[achievement.id] = true; });

    return { progress, newlyUnlocked, expGained, pointsGained };
}

// Version complète : marque les succès ET applique leur récompense (l'EXP peut
// elle-même faire franchir un niveau, qui peut débloquer un skin — géré par
// applyExpGain, importé de levels.js). Fonction pure.
export function applyAchievementUnlocksWithExp(currentProgress) {
    const base = applyAchievementUnlocks(currentProgress);
    let next = base.progress;
    let newSkins = [];
    let levelsGained = 0;
    let levelPointsGained = 0; // points DUO gagnés via un niveau franchi grâce à l'EXP des succès

    if (base.expGained > 0) {
        const expResult = applyExpGain(next, base.expGained);
        next = expResult.progress;
        newSkins = expResult.summary.newSkins;
        levelsGained = expResult.summary.levelsGained;
        levelPointsGained = expResult.summary.pointsGained;
    }

    if (base.pointsGained > 0) {
        next = { ...next, duoPoints: (next.duoPoints || 0) + base.pointsGained };
    }

    return {
        progress: next,
        newlyUnlocked: base.newlyUnlocked,
        newSkins,
        levelsGained,
        levelPointsGained,     // points venant d'un niveau franchi (à ajouter à ceux de la partie)
        achievementPoints: base.pointsGained // points DUO directement offerts par les succès (affichés à part)
    };
}

// ---------------------------------------------------------------------------
// AFFICHAGE
// ---------------------------------------------------------------------------

// Vue complète d'un succès pour le menu : son état actuel pour ce joueur
export function getAchievementView(achievement, progress) {
    const stats = buildStats(progress);
    const unlocked = !!progress?.unlockedAchievements?.[achievement.id];
    const tier = getTier(achievement.tier);
    const progressInfo = achievement.progress ? achievement.progress(stats) : null;

    return {
        id: achievement.id,
        category: achievement.category,
        icon: achievement.icon,
        name: achievement.name,
        description: achievement.description,
        tier: achievement.tier,
        tierLabel: tier.label,
        tierIcon: tier.icon,
        exp: tier.exp,
        points: tier.points,
        unlocked,
        progress: progressInfo
            ? { current: Math.min(progressInfo.current, progressInfo.target), target: progressInfo.target }
            : null
    };
}

export function getAchievementsSummary(progress) {
    const unlocked = progress?.unlockedAchievements || {};
    const unlockedCount = ACHIEVEMENTS.filter(achievement => unlocked[achievement.id]).length;
    return { unlockedCount, totalCount: ACHIEVEMENTS.length };
}