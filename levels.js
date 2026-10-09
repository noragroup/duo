// levels.js - Système de niveaux (logique pure : pas de Firebase, pas de DOM)
//
// - On gagne de l'EXP à la FIN d'une partie (jamais pendant).
// - L'EXP total est la seule donnée de base : le niveau en est déduit.
// - À certains niveaux, on débloque des skins. Pour ajouter une récompense,
//   il suffit de déclarer dans SKINS (skins.js) un skin avec :
//       unlock: "level", unlockLevel: 5
// - Chaque niveau gagné donne des "points DUO" (pour la future boutique).

import { SKINS } from "./skins.js";

// ---------------------------------------------------------------------------
// RÉGLAGES (tout se règle ici)
// ---------------------------------------------------------------------------

export const LEVEL_CONFIG = {
    // Courbe : passer du niveau N au niveau N+1 coûte
    //   firstLevelExp + expIncreasePerLevel * N
    firstLevelExp: 200,        // niveau 0 -> 1
    expIncreasePerLevel: 25,   // chaque niveau coûte 25 EXP de plus que le précédent

    // EXP gagné en fin de partie, selon la place au classement :
    // le 1er gagne expFirstPlace, le dernier expLastPlace, et les places
    // intermédiaires sont réparties régulièrement entre les deux.
    expFirstPlace: 250,
    expLastPlace: 100,
    expRoundTo: 5,             // arrondi des places intermédiaires (ex : 212,5 -> 215)

    // Points DUO gagnés à chaque niveau
    duoPointsPerLevel: 10,        // à chaque niveau...
    duoPointsMilestoneEvery: 5,   // ...sauf tous les 5 niveaux...
    duoPointsMilestone: 50,       // ...où l'on gagne 50 points à la place

    // Anti-abus : pas d'EXP pour les parties bidons
    minParticipants: 2,        // nombre de joueurs minimum au lancement de la partie
    minGameDurationMs: 15000   // durée minimum d'une partie pour donner de l'EXP
};

// ---------------------------------------------------------------------------
// COURBE D'EXP
// ---------------------------------------------------------------------------

// EXP nécessaire pour passer du niveau `level` au niveau `level + 1`
export function expToReachNextLevel(level) {
    return LEVEL_CONFIG.firstLevelExp + LEVEL_CONFIG.expIncreasePerLevel * level;
}

// EXP total nécessaire pour ATTEINDRE le niveau `level`
export function totalExpForLevel(level) {
    if (level <= 0) return 0;
    return (
        LEVEL_CONFIG.firstLevelExp * level +
        LEVEL_CONFIG.expIncreasePerLevel * (level * (level - 1)) / 2
    );
}

export function getLevelFromExp(exp) {
    let level = 0;
    while (totalExpForLevel(level + 1) <= exp) level++;
    return level;
}

// Infos pour afficher une barre de progression
export function getLevelProgress(exp) {
    const level = getLevelFromExp(exp);
    const expInLevel = exp - totalExpForLevel(level);
    const expNeeded = expToReachNextLevel(level);

    return {
        level: level,
        expInLevel: expInLevel,
        expNeeded: expNeeded,
        ratio: Math.min(1, expInLevel / expNeeded)
    };
}

// ---------------------------------------------------------------------------
// RÉCOMPENSES
// ---------------------------------------------------------------------------

// Skins débloqués en atteignant exactement ce niveau
export function getRewardsForLevel(level) {
    return SKINS.filter(skin => skin.unlock === "level" && skin.unlockLevel === level);
}

// Points DUO gagnés en atteignant ce niveau
export function getDuoPointsForLevel(level) {
    if (level > 0 && level % LEVEL_CONFIG.duoPointsMilestoneEvery === 0) {
        return LEVEL_CONFIG.duoPointsMilestone;
    }
    return LEVEL_CONFIG.duoPointsPerLevel;
}

// Récompense complète d'un niveau : { level, points, skins }
export function getLevelReward(level) {
    return {
        level: level,
        points: getDuoPointsForLevel(level),
        skins: getRewardsForLevel(level)
    };
}

// Jusqu'à quel niveau afficher la liste des récompenses :
// au moins 20, toujours un peu au-delà du niveau actuel et de la dernière récompense de skin
export function getRewardTableMaxLevel(currentLevel) {
    const skinLevels = SKINS
        .filter(skin => skin.unlock === "level")
        .map(skin => skin.unlockLevel);
    const highestSkinLevel = skinLevels.length > 0 ? Math.max(...skinLevels) : 0;

    const target = Math.max(20, currentLevel + 10, highestSkinLevel + 5);
    return Math.ceil(target / 5) * 5;
}

// Prochaine récompense après ce niveau : { level, skins } ou null s'il n'y en a plus
export function getNextReward(currentLevel) {
    const levels = SKINS
        .filter(skin => skin.unlock === "level" && skin.unlockLevel > currentLevel)
        .map(skin => skin.unlockLevel);

    if (levels.length === 0) return null;

    const nextLevel = Math.min(...levels);
    return { level: nextLevel, skins: getRewardsForLevel(nextLevel) };
}

// ---------------------------------------------------------------------------
// FIN DE PARTIE
// ---------------------------------------------------------------------------

// EXP gagné selon la place (1 = gagnant) et le nombre de joueurs classés.
// Exemples : 2 joueurs -> 250 / 100 ; 3 joueurs -> 250 / 175 / 100 ;
//            4 joueurs -> 250 / 200 / 150 / 100
export function computeExpForRank(rank, totalPlayers) {
    const best = LEVEL_CONFIG.expFirstPlace;
    const worst = LEVEL_CONFIG.expLastPlace;
    const step = LEVEL_CONFIG.expRoundTo;

    if (totalPlayers <= 1) return best;

    const place = Math.min(Math.max(rank, 1), totalPlayers);
    const ratio = (place - 1) / (totalPlayers - 1); // 0 = premier, 1 = dernier
    const exp = best - (best - worst) * ratio;

    return Math.round(exp / step) * step;
}

// Détail de la récompense : une base (le dernier gagne déjà ça) + un bonus de place
export function computeGameReward(rank, totalPlayers) {
    const total = computeExpForRank(rank, totalPlayers);
    const played = Math.min(LEVEL_CONFIG.expLastPlace, total);

    return {
        rank: rank,
        totalPlayers: totalPlayers,
        played: played,
        placeBonus: total - played,
        total: total
    };
}

export function createEmptyProgress() {
    return {
        exp: 0,
        duoPoints: 0,
        gamesPlayed: 0,
        gamesWon: 0,
        unlockedSkins: {},
        lastRewardedGame: null
    };
}

// Applique le résultat d'une partie à la progression d'un joueur.
// Fonction pure : retourne { progress, summary } sans rien modifier.
export function applyGameReward(currentProgress, { rank, totalPlayers, gameId }) {
    const progress = {
        ...createEmptyProgress(),
        ...currentProgress,
        unlockedSkins: { ...(currentProgress?.unlockedSkins || {}) }
    };

    const won = rank === 1;
    const reward = computeGameReward(rank, totalPlayers);
    const oldExp = progress.exp || 0;
    const oldLevel = getLevelFromExp(oldExp);

    progress.exp = oldExp + reward.total;

    const newLevel = getLevelFromExp(progress.exp);
    const levelsGained = newLevel - oldLevel;

    // Points DUO et skins de chaque niveau franchi (au cas où on en saute plusieurs)
    let pointsGained = 0;
    const newSkins = [];
    for (let level = oldLevel + 1; level <= newLevel; level++) {
        pointsGained += getDuoPointsForLevel(level);

        for (const skin of getRewardsForLevel(level)) {
            if (!progress.unlockedSkins[skin.id]) {
                progress.unlockedSkins[skin.id] = true;
                newSkins.push({ id: skin.id, name: skin.name });
            }
        }
    }

    progress.duoPoints = (progress.duoPoints || 0) + pointsGained;

    progress.gamesPlayed = (progress.gamesPlayed || 0) + 1;
    if (won) progress.gamesWon = (progress.gamesWon || 0) + 1;
    progress.lastRewardedGame = gameId;

    return {
        progress: progress,
        summary: {
            won: won,
            rank: rank,
            totalPlayers: totalPlayers,
            reward: reward,
            oldExp: oldExp,
            newExp: progress.exp,
            oldLevel: oldLevel,
            newLevel: newLevel,
            levelsGained: levelsGained,
            pointsGained: pointsGained,
            newSkins: newSkins
        }
    };
}