# Pre-game prediction backtest

Generated 2026-11-27T21:03Z by `scripts/backtest.mjs`. Walk-forward: every number below is out of sample. Each test season was predicted by a model trained only on earlier seasons, using information available before kickoff (Elo, standings and simulations rebuilt as of the game date; closing lines only in the 0-2 day tier).

Targets are the post-game excitement ratings from our own algorithm. Metrics:

- **Spearman / within-day ρ:** rank correlation of predicted vs actual, overall and within each day (football: each week).
- **Top-10% ≥65:** share of the predicted top 10% of games that rated Good or better.
- **Great recall:** share of actual Great (85+) games that we had in our predicted top 20%.
- **AUC:** how well predictions separate Great from Dull games (0.5 = coin flip).
- **Brier:** accuracy of P(Great) (lower is better; ~0.11 = always guessing the base rate of 12.5%).
- **Sampling noise:** with n test games, a rank correlation has a standard error of about 1/√n (±0.06 for the NFL's 285) and the top-decile share about √(p(1−p)/(0.1·n)) (±9 points for the NFL). Smaller differences are ties, which is why the verdicts need +0.02 ρ *and* +5 points to call a win.
- **Leakage guard:** predictions only see `pregameView(game)` (no scores, status, plays or post-game records; series and aggregates are backed out). `test/predict.test.mjs` fails if a post-kickoff field changes a prediction.

## Summary (0-2 days out, model in use)

| League | Model | Within-day ρ | Spread-only ρ | Top-10% ≥65 | Spread-only top-10% | AUC Great vs Dull | Verdict |
|---|---|---|---|---|---|---|---|
| NFL | rules | 0.19 | 0.19 | 31% | 37% | 0.69 | falls short of spread-only |
| CFB | rules | 0.43 | 0.46 | 62% | 54% | 0.83 | falls short of spread-only |
| NBA | rules | 0.27 | 0.28 | 44% | 44% | 0.68 | roughly ties spread-only |
| WNBA | rules | 0.18 | 0.15 | 53% | 49% | 0.71 | roughly ties spread-only |
| NHL | rules | 0.03 | 0.03 | 49% | 31% | 0.59 | roughly ties spread-only |
| MLB | rules | 0.00 | 0.02 | 35% | 39% | 0.53 | falls short of spread-only |
| MCBB | rules | 0.44 | 0.44 | 58% | 62% | 0.84 | roughly ties spread-only |
| WCBB | fitted | 0.56 | 0.55 | 76% | 64% | 0.88 | roughly ties spread-only |
| EPL | rules | 0.03 | 0.05 | 39% | 32% | 0.54 | roughly ties spread-only |
| WSL | rules | 0.24 | 0.21 | 39% | 25% | 0.62 | clearly beats spread-only |
| UCL | rules | 0.16 | 0.09 | 55% | 29% | 0.79 | clearly beats spread-only |
| UEL | rules | 0.04 | 0.06 | 50% | 26% | 0.65 | roughly ties spread-only |
| MLS | rules | 0.06 | 0.05 | 32% | 31% | 0.56 | roughly ties spread-only |
| NWSL | rules | 0.18 | 0.18 | 41% | 34% | 0.58 | roughly ties spread-only |
| F1 | rules | -0.04 | — | 44% | 36% | 0.51 | has no spread-only baseline (no lines or ratings to derive one) |

## NFL

Seasons 2024, 2025 · 570 games backfilled · tested on 2025 (trained only on earlier seasons) · 26 playoff games.

| Horizon | Model | n | Spearman | Within-day ρ | Top-10% ≥65 | Great recall (top 20%) | AUC Great vs Dull | Brier P(Great) | MAE |
|---|---|---|---|---|---|---|---|---|---|
| 0-2 days | **Fitted ridge** | 285 | 0.20 | 0.13 | 48% | 38% | 0.67 | 0.118 | 25.1 |
| 0-2 days | Rules (config) | 285 | 0.22 | 0.19 | 31% | 28% | 0.69 | — | 24.7 |
| 0-2 days | Spread only | 285 | 0.18 | 0.19 | 37% | 30% | 0.64 | — | 25.2 |
| 0-2 days | 538-style quality+importance | 285 | 0.09 | 0.12 | 41% | 23% | 0.58 | — | 25.3 |
| 0-2 days | Constant base rate | 285 | — | — | 35% | 20% | 0.50 | — | 25.3 |
| 0-2 days, closing line | **Fitted ridge** | 105 | 0.38 | 0.28 | 64% | 56% | 0.78 | 0.133 | 25.7 |
| 0-2 days, closing line | Rules (config) | 105 | 0.42 | 0.30 | 64% | 56% | 0.82 | — | 24.4 |
| 0-2 days, closing line | Spread only | 105 | 0.35 | 0.29 | 73% | 44% | 0.76 | — | 26.0 |
| 3-7 days | **Fitted ridge** | 285 | 0.21 | 0.13 | 59% | 38% | 0.68 | 0.118 | 25.1 |
| 3-7 days | Rules (config) | 285 | 0.23 | 0.20 | 47% | 33% | 0.69 | — | 24.7 |
| 3-7 days | Spread only | 285 | 0.18 | 0.17 | 38% | 25% | 0.66 | — | 25.1 |
| 3-7 days | 538-style quality+importance | 285 | 0.08 | 0.12 | 38% | 23% | 0.55 | — | 25.3 |
| 3-7 days | Constant base rate | 285 | — | — | 35% | 20% | 0.50 | — | 25.3 |
| 8-14 days | **Fitted ridge** | 285 | 0.17 | 0.09 | 52% | 35% | 0.64 | 0.118 | 25.1 |
| 8-14 days | Rules (config) | 285 | 0.20 | 0.15 | 48% | 35% | 0.66 | — | 24.7 |
| 8-14 days | Spread only | 285 | 0.13 | 0.11 | 28% | 18% | 0.60 | — | 25.2 |
| 8-14 days | 538-style quality+importance | 285 | 0.09 | 0.10 | 41% | 25% | 0.57 | — | 25.3 |
| 8-14 days | Constant base rate | 285 | — | — | 35% | 20% | 0.50 | — | 25.3 |

**Verdict (0-2 days, rules model):** falls short of spread-only on within-day correlation (0.19 vs 0.19) and top-decile precision (31% vs 37%). Closing line available for 37% of test games.

P(Great) calibration (0-2 days, fitted):

| Predicted | n | Mean predicted | Observed |
|---|---|---|---|
| 0-5% | 17 | 4% | 12% |
| 5-10% | 119 | 8% | 7% |
| 10-15% | 110 | 12% | 16% |
| 15-20% | 32 | 16% | 28% |
| 20-30% | 7 | 23% | 43% |
| 30-100% | 0 | — | — |

Model in use: **rules**. Base rate regular 43.7 (median rating 48.9), playoff 54.2 (median 65.0); bases are the medians minus the rule terms' average contribution, so typical stakes aren't counted twice. Rules k supported by the data: 0.59.

<details><summary>Fitted coefficients (points per unit)</summary>

| Feature | Coef |
|---|---|
| closeness | 0.116 |
| quality | 0.325 |
| importance | 0.015 |
| stakes | 0.435 |
| style | 0.237 |
| narrative | 0.528 |
| availability | 0 |
| matchup | 0 |
| weather | 0 |
| total | 0.327 |
| closeAbs | -6.379 |
| closeAbs2 | -20.407 |
| intercept | 49.62 |

</details>

## CFB

Seasons 2023, 2024, 2025 · 864 games backfilled · tested on 2024, 2025 (trained only on earlier seasons) · 58 playoff games.

| Horizon | Model | n | Spearman | Within-day ρ | Top-10% ≥65 | Great recall (top 20%) | AUC Great vs Dull | Brier P(Great) | MAE |
|---|---|---|---|---|---|---|---|---|---|
| 0-2 days | **Fitted ridge** | 581 | 0.52 | 0.45 | 61% | 33% | 0.84 | 0.116 | 21.7 |
| 0-2 days | Rules (config) | 581 | 0.52 | 0.43 | 62% | 41% | 0.83 | — | 22.1 |
| 0-2 days | Spread only | 581 | 0.50 | 0.46 | 54% | 33% | 0.83 | — | 22.1 |
| 0-2 days | 538-style quality+importance | 581 | 0.40 | 0.35 | 48% | 30% | 0.77 | — | 23.7 |
| 0-2 days | Constant base rate | 581 | — | — | 36% | 20% | 0.50 | — | 24.4 |
| 0-2 days, closing line | **Fitted ridge** | 43 | 0.52 | 0.37 | 40% | 31% | 0.96 | 0.213 | 22.6 |
| 0-2 days, closing line | Rules (config) | 43 | 0.54 | 0.40 | 60% | 38% | 0.88 | — | 20.6 |
| 0-2 days, closing line | Spread only | 43 | 0.49 | 0.30 | 43% | 23% | 0.98 | — | 23.5 |
| 3-7 days | **Fitted ridge** | 581 | 0.51 | 0.44 | 58% | 37% | 0.83 | 0.115 | 21.7 |
| 3-7 days | Rules (config) | 581 | 0.52 | 0.43 | 62% | 40% | 0.83 | — | 22.1 |
| 3-7 days | Spread only | 581 | 0.51 | 0.46 | 54% | 37% | 0.83 | — | 22.1 |
| 3-7 days | 538-style quality+importance | 581 | 0.40 | 0.35 | 48% | 31% | 0.77 | — | 23.7 |
| 3-7 days | Constant base rate | 581 | — | — | 36% | 20% | 0.50 | — | 24.4 |
| 8-14 days | **Fitted ridge** | 581 | 0.52 | 0.44 | 56% | 38% | 0.84 | 0.115 | 21.6 |
| 8-14 days | Rules (config) | 581 | 0.52 | 0.44 | 58% | 42% | 0.84 | — | 22.0 |
| 8-14 days | Spread only | 581 | 0.51 | 0.45 | 61% | 37% | 0.84 | — | 22.0 |
| 8-14 days | 538-style quality+importance | 581 | 0.40 | 0.35 | 44% | 30% | 0.76 | — | 23.6 |
| 8-14 days | Constant base rate | 581 | — | — | 36% | 20% | 0.50 | — | 24.4 |

**Verdict (0-2 days, rules model):** falls short of spread-only on within-day correlation (0.43 vs 0.46) and top-decile precision (62% vs 54%). Closing line available for 7% of test games.

P(Great) calibration (0-2 days, fitted):

| Predicted | n | Mean predicted | Observed |
|---|---|---|---|
| 0-5% | 201 | 3% | 3% |
| 5-10% | 113 | 7% | 15% |
| 10-15% | 103 | 13% | 20% |
| 15-20% | 75 | 17% | 19% |
| 20-30% | 71 | 24% | 21% |
| 30-100% | 18 | 35% | 39% |

Model in use: **rules**. Base rate regular 42.3 (median rating 48.4), playoff 56.1 (median 73.7); bases are the medians minus the rule terms' average contribution, so typical stakes aren't counted twice. Rules k supported by the data: 1.69.

<details><summary>Fitted coefficients (points per unit)</summary>

| Feature | Coef |
|---|---|
| closeness | 0.405 |
| quality | 1.069 |
| importance | 0 |
| stakes | 0.303 |
| style | 0.359 |
| narrative | 0.8 |
| availability | 0 |
| matchup | 0 |
| weather | 0 |
| total | 0.394 |
| closeAbs | -17.958 |
| closeAbs2 | -40.74 |
| intercept | 50.56 |

</details>

## NBA

Seasons 2025, 2026 · 2639 games backfilled · tested on 2026 (trained only on earlier seasons) · 165 playoff games.

| Horizon | Model | n | Spearman | Within-day ρ | Top-10% ≥65 | Great recall (top 20%) | AUC Great vs Dull | Brier P(Great) | MAE |
|---|---|---|---|---|---|---|---|---|---|
| 0-2 days | **Fitted ridge** | 1318 | 0.28 | 0.29 | 42% | 30% | 0.68 | 0.107 | 24.1 |
| 0-2 days | Rules (config) | 1318 | 0.26 | 0.27 | 44% | 32% | 0.68 | — | 23.8 |
| 0-2 days | Spread only | 1318 | 0.27 | 0.28 | 44% | 28% | 0.66 | — | 24.2 |
| 0-2 days | 538-style quality+importance | 1318 | 0.15 | 0.11 | 40% | 30% | 0.62 | — | 24.7 |
| 0-2 days | Constant base rate | 1318 | — | — | 33% | 20% | 0.50 | — | 24.7 |
| 0-2 days, closing line | **Fitted ridge** | 1066 | 0.29 | 0.28 | 41% | 31% | 0.69 | 0.106 | 24.2 |
| 0-2 days, closing line | Rules (config) | 1066 | 0.28 | 0.28 | 45% | 33% | 0.69 | — | 23.8 |
| 0-2 days, closing line | Spread only | 1066 | 0.27 | 0.27 | 39% | 25% | 0.66 | — | 24.2 |
| 3-7 days | **Fitted ridge** | 1318 | 0.24 | 0.23 | 34% | 26% | 0.64 | 0.108 | 24.3 |
| 3-7 days | Rules (config) | 1318 | 0.23 | 0.21 | 40% | 26% | 0.64 | — | 24.1 |
| 3-7 days | Spread only | 1318 | 0.21 | 0.21 | 42% | 24% | 0.61 | — | 24.3 |
| 3-7 days | 538-style quality+importance | 1318 | 0.15 | 0.11 | 37% | 28% | 0.61 | — | 24.7 |
| 3-7 days | Constant base rate | 1318 | — | — | 33% | 20% | 0.50 | — | 24.7 |
| 8-14 days | **Fitted ridge** | 1318 | 0.23 | 0.21 | 39% | 26% | 0.64 | 0.108 | 24.3 |
| 8-14 days | Rules (config) | 1318 | 0.21 | 0.21 | 43% | 27% | 0.64 | — | 24.2 |
| 8-14 days | Spread only | 1318 | 0.20 | 0.21 | 37% | 26% | 0.61 | — | 24.3 |
| 8-14 days | 538-style quality+importance | 1318 | 0.14 | 0.11 | 33% | 28% | 0.60 | — | 24.7 |
| 8-14 days | Constant base rate | 1318 | — | — | 33% | 20% | 0.50 | — | 24.7 |

**Verdict (0-2 days, rules model):** roughly ties spread-only on within-day correlation (0.27 vs 0.28) and top-decile precision (44% vs 44%). Closing line available for 81% of test games.

P(Great) calibration (0-2 days, fitted):

| Predicted | n | Mean predicted | Observed |
|---|---|---|---|
| 0-5% | 0 | — | — |
| 5-10% | 332 | 8% | 6% |
| 10-15% | 604 | 13% | 13% |
| 15-20% | 368 | 17% | 18% |
| 20-30% | 14 | 21% | 21% |
| 30-100% | 0 | — | — |

Model in use: **rules**. Base rate regular 45.8 (median rating 48.7), playoff 52.7 (median 62.4); bases are the medians minus the rule terms' average contribution, so typical stakes aren't counted twice. Rules k supported by the data: 0.86.

<details><summary>Fitted coefficients (points per unit)</summary>

| Feature | Coef |
|---|---|
| closeness | 0.179 |
| quality | 0.481 |
| importance | 0.152 |
| stakes | 0.119 |
| style | 0.069 |
| narrative | 0.564 |
| availability | 0 |
| matchup | 0 |
| weather | 0 |
| total | -0.153 |
| closeAbs | -8.106 |
| closeAbs2 | -21.524 |
| intercept | 50.54 |

</details>

## WNBA

Seasons 2025, 2026 · 663 games backfilled · tested on 2026 (trained only on earlier seasons) · 47 playoff games.

| Horizon | Model | n | Spearman | Within-day ρ | Top-10% ≥65 | Great recall (top 20%) | AUC Great vs Dull | Brier P(Great) | MAE |
|---|---|---|---|---|---|---|---|---|---|
| 0-2 days | **Fitted ridge** | 352 | 0.29 | 0.13 | 50% | 42% | 0.72 | 0.105 | 24.1 |
| 0-2 days | Rules (config) | 352 | 0.29 | 0.18 | 53% | 40% | 0.71 | — | 24.0 |
| 0-2 days | Spread only | 352 | 0.26 | 0.15 | 49% | 29% | 0.67 | — | 24.3 |
| 0-2 days | 538-style quality+importance | 352 | 0.13 | -0.04 | 30% | 29% | 0.58 | — | 24.6 |
| 0-2 days | Constant base rate | 352 | — | — | 35% | 20% | 0.50 | — | 24.7 |
| 0-2 days, closing line | **Fitted ridge** | 352 | 0.29 | 0.13 | 50% | 42% | 0.72 | 0.105 | 24.1 |
| 0-2 days, closing line | Rules (config) | 352 | 0.29 | 0.18 | 53% | 40% | 0.71 | — | 24.0 |
| 0-2 days, closing line | Spread only | 352 | 0.26 | 0.15 | 49% | 29% | 0.67 | — | 24.3 |
| 3-7 days | **Fitted ridge** | 352 | 0.28 | 0.10 | 42% | 40% | 0.73 | 0.105 | 24.2 |
| 3-7 days | Rules (config) | 352 | 0.29 | 0.06 | 42% | 40% | 0.73 | — | 24.4 |
| 3-7 days | Spread only | 352 | 0.26 | 0.15 | 53% | 22% | 0.66 | — | 24.4 |
| 3-7 days | 538-style quality+importance | 352 | 0.13 | -0.07 | 31% | 29% | 0.58 | — | 24.6 |
| 3-7 days | Constant base rate | 352 | — | — | 35% | 20% | 0.50 | — | 24.7 |
| 8-14 days | **Fitted ridge** | 352 | 0.28 | 0.08 | 47% | 40% | 0.73 | 0.105 | 24.2 |
| 8-14 days | Rules (config) | 352 | 0.28 | 0.07 | 44% | 40% | 0.73 | — | 24.4 |
| 8-14 days | Spread only | 352 | 0.25 | 0.16 | 47% | 20% | 0.65 | — | 24.4 |
| 8-14 days | 538-style quality+importance | 352 | 0.14 | 0.05 | 33% | 29% | 0.58 | — | 24.6 |
| 8-14 days | Constant base rate | 352 | — | — | 35% | 20% | 0.50 | — | 24.7 |

**Verdict (0-2 days, rules model):** roughly ties spread-only on within-day correlation (0.18 vs 0.15) and top-decile precision (53% vs 49%). Closing line available for 100% of test games.

P(Great) calibration (0-2 days, fitted):

| Predicted | n | Mean predicted | Observed |
|---|---|---|---|
| 0-5% | 65 | 3% | 6% |
| 5-10% | 133 | 7% | 9% |
| 10-15% | 70 | 12% | 13% |
| 15-20% | 39 | 17% | 18% |
| 20-30% | 26 | 23% | 23% |
| 30-100% | 19 | 35% | 37% |

Model in use: **rules**. Base rate regular 41.3 (median rating 48.6), playoff 52.0 (median 67.3); bases are the medians minus the rule terms' average contribution, so typical stakes aren't counted twice. Rules k supported by the data: 1.03.

<details><summary>Fitted coefficients (points per unit)</summary>

| Feature | Coef |
|---|---|
| closeness | 0.188 |
| quality | 0.466 |
| importance | 0.103 |
| stakes | 0.389 |
| style | -0.014 |
| narrative | 0.627 |
| availability | 0 |
| matchup | 0 |
| weather | 0 |
| total | -0.28 |
| closeAbs | -8.225 |
| closeAbs2 | -22.89 |
| intercept | 49.7 |

</details>

## NHL

Seasons 2025, 2026 · 2799 games backfilled · tested on 2026 (trained only on earlier seasons) · 168 playoff games.

| Horizon | Model | n | Spearman | Within-day ρ | Top-10% ≥65 | Great recall (top 20%) | AUC Great vs Dull | Brier P(Great) | MAE |
|---|---|---|---|---|---|---|---|---|---|
| 0-2 days | **Fitted ridge** | 1394 | 0.06 | 0.01 | 49% | 30% | 0.56 | 0.118 | 24.7 |
| 0-2 days | Rules (config) | 1394 | 0.07 | 0.03 | 49% | 35% | 0.59 | — | 24.5 |
| 0-2 days | Spread only | 1394 | 0.01 | 0.03 | 31% | 18% | 0.48 | — | 24.7 |
| 0-2 days | 538-style quality+importance | 1394 | 0.03 | 0.01 | 38% | 26% | 0.55 | — | 24.7 |
| 0-2 days | Constant base rate | 1394 | — | — | 37% | 20% | 0.50 | — | 24.6 |
| 0-2 days, closing line | **Fitted ridge** | 1018 | 0.08 | 0.03 | 47% | 32% | 0.57 | 0.123 | 25.3 |
| 0-2 days, closing line | Rules (config) | 1018 | 0.08 | 0.03 | 50% | 37% | 0.60 | — | 25.2 |
| 0-2 days, closing line | Spread only | 1018 | 0.01 | 0.03 | 32% | 20% | 0.48 | — | 25.3 |
| 3-7 days | **Fitted ridge** | 1394 | 0.07 | 0.03 | 51% | 32% | 0.56 | 0.118 | 24.7 |
| 3-7 days | Rules (config) | 1394 | 0.09 | 0.06 | 48% | 30% | 0.60 | — | 24.4 |
| 3-7 days | Spread only | 1394 | -0.00 | 0.01 | 34% | 16% | 0.48 | — | 24.8 |
| 3-7 days | 538-style quality+importance | 1394 | 0.06 | 0.04 | 42% | 27% | 0.57 | — | 24.7 |
| 3-7 days | Constant base rate | 1394 | — | — | 37% | 20% | 0.50 | — | 24.6 |
| 8-14 days | **Fitted ridge** | 1394 | 0.06 | 0.02 | 49% | 32% | 0.56 | 0.118 | 24.7 |
| 8-14 days | Rules (config) | 1394 | 0.08 | 0.05 | 47% | 32% | 0.61 | — | 24.4 |
| 8-14 days | Spread only | 1394 | 0.01 | 0.02 | 36% | 18% | 0.49 | — | 24.8 |
| 8-14 days | 538-style quality+importance | 1394 | 0.06 | 0.03 | 39% | 27% | 0.58 | — | 24.7 |
| 8-14 days | Constant base rate | 1394 | — | — | 37% | 20% | 0.50 | — | 24.6 |

**Verdict (0-2 days, rules model):** roughly ties spread-only on within-day correlation (0.03 vs 0.03) and top-decile precision (49% vs 31%). Closing line available for 73% of test games.

P(Great) calibration (0-2 days, fitted):

| Predicted | n | Mean predicted | Observed |
|---|---|---|---|
| 0-5% | 0 | — | — |
| 5-10% | 584 | 9% | 12% |
| 10-15% | 780 | 11% | 14% |
| 15-20% | 8 | 17% | 50% |
| 20-30% | 1 | 20% | 100% |
| 30-100% | 21 | 38% | 29% |

Model in use: **rules**. Base rate regular 48.6 (median rating 49.5), playoff 69.2 (median 72.0); bases are the medians minus the rule terms' average contribution, so typical stakes aren't counted twice. Rules k supported by the data: 0.36.

<details><summary>Fitted coefficients (points per unit)</summary>

| Feature | Coef |
|---|---|
| closeness | 0.047 |
| quality | 0.165 |
| importance | 0.041 |
| stakes | 0.433 |
| style | 0.041 |
| narrative | 1.262 |
| availability | 0 |
| matchup | 0 |
| weather | 0 |
| total | 0 |
| closeAbs | -0.666 |
| closeAbs2 | -4.659 |
| intercept | 48.86 |

</details>

## MLB

Seasons 2025, 2026 · 4946 games backfilled · tested on 2026 (trained only on earlier seasons) · 87 playoff games.

| Horizon | Model | n | Spearman | Within-day ρ | Top-10% ≥65 | Great recall (top 20%) | AUC Great vs Dull | Brier P(Great) | MAE |
|---|---|---|---|---|---|---|---|---|---|
| 0-2 days | **Fitted ridge** | 2469 | 0.01 | -0.01 | 36% | 19% | 0.50 | 0.101 | 24.2 |
| 0-2 days | Rules (config) | 2469 | 0.03 | 0.00 | 35% | 23% | 0.53 | — | 24.3 |
| 0-2 days | Spread only | 2469 | 0.02 | 0.02 | 39% | 22% | 0.51 | — | 24.2 |
| 0-2 days | 538-style quality+importance | 2469 | 0.02 | -0.00 | 35% | 25% | 0.52 | — | 24.2 |
| 0-2 days | Constant base rate | 2469 | — | — | 33% | 20% | 0.50 | — | 24.3 |
| 0-2 days, closing line | **Fitted ridge** | 2469 | 0.01 | -0.01 | 36% | 19% | 0.50 | 0.101 | 24.2 |
| 0-2 days, closing line | Rules (config) | 2469 | 0.03 | 0.00 | 35% | 23% | 0.53 | — | 24.3 |
| 0-2 days, closing line | Spread only | 2469 | 0.02 | 0.02 | 39% | 22% | 0.51 | — | 24.2 |
| 3-7 days | **Fitted ridge** | 2469 | 0.02 | -0.01 | 34% | 21% | 0.52 | 0.101 | 24.2 |
| 3-7 days | Rules (config) | 2469 | 0.02 | -0.01 | 34% | 23% | 0.52 | — | 24.3 |
| 3-7 days | Spread only | 2469 | 0.03 | 0.02 | 34% | 25% | 0.52 | — | 24.2 |
| 3-7 days | 538-style quality+importance | 2469 | 0.01 | -0.01 | 38% | 24% | 0.50 | — | 24.2 |
| 3-7 days | Constant base rate | 2469 | — | — | 33% | 20% | 0.50 | — | 24.3 |
| 8-14 days | **Fitted ridge** | 2469 | 0.02 | -0.01 | 36% | 21% | 0.51 | 0.101 | 24.2 |
| 8-14 days | Rules (config) | 2469 | 0.01 | -0.02 | 37% | 22% | 0.52 | — | 24.4 |
| 8-14 days | Spread only | 2469 | 0.02 | 0.00 | 33% | 20% | 0.51 | — | 24.3 |
| 8-14 days | 538-style quality+importance | 2469 | 0.02 | -0.00 | 38% | 22% | 0.51 | — | 24.2 |
| 8-14 days | Constant base rate | 2469 | — | — | 33% | 20% | 0.50 | — | 24.3 |

**Verdict (0-2 days, rules model):** falls short of spread-only on within-day correlation (0.00 vs 0.02) and top-decile precision (35% vs 39%). Closing line available for 100% of test games.

P(Great) calibration (0-2 days, fitted):

| Predicted | n | Mean predicted | Observed |
|---|---|---|---|
| 0-5% | 0 | — | — |
| 5-10% | 295 | 9% | 13% |
| 10-15% | 2125 | 12% | 11% |
| 15-20% | 30 | 17% | 10% |
| 20-30% | 19 | 21% | 26% |
| 30-100% | 0 | — | — |

Model in use: **rules**. Base rate regular 47.6 (median rating 48.7), playoff 71.1 (median 74.7); bases are the medians minus the rule terms' average contribution, so typical stakes aren't counted twice. Rules k supported by the data: 0.30.

<details><summary>Fitted coefficients (points per unit)</summary>

| Feature | Coef |
|---|---|
| closeness | 0.049 |
| quality | 0.18 |
| importance | -0.018 |
| stakes | 0.37 |
| style | -0.11 |
| narrative | 0.423 |
| availability | 0 |
| matchup | 0 |
| weather | 0 |
| total | -0.578 |
| closeAbs | -3.559 |
| closeAbs2 | -25.084 |
| intercept | 48.58 |

</details>

## MCBB

Seasons 2024, 2025, 2026 · 2427 games backfilled · tested on 2025, 2026 (trained only on earlier seasons) · 203 playoff games.

| Horizon | Model | n | Spearman | Within-day ρ | Top-10% ≥65 | Great recall (top 20%) | AUC Great vs Dull | Brier P(Great) | MAE |
|---|---|---|---|---|---|---|---|---|---|
| 0-2 days | **Fitted ridge** | 1601 | 0.54 | 0.45 | 63% | 40% | 0.84 | 0.111 | 20.8 |
| 0-2 days | Rules (config) | 1601 | 0.53 | 0.44 | 58% | 43% | 0.84 | — | 22.0 |
| 0-2 days | Spread only | 1601 | 0.51 | 0.44 | 62% | 39% | 0.82 | — | 21.3 |
| 0-2 days | 538-style quality+importance | 1601 | 0.44 | 0.32 | 58% | 39% | 0.79 | — | 23.8 |
| 0-2 days | Constant base rate | 1601 | — | — | 35% | 20% | 0.50 | — | 24.6 |
| 0-2 days, closing line | **Fitted ridge** | 673 | 0.59 | 0.45 | 63% | 36% | 0.87 | 0.119 | 19.7 |
| 0-2 days, closing line | Rules (config) | 673 | 0.57 | 0.44 | 66% | 41% | 0.86 | — | 20.8 |
| 0-2 days, closing line | Spread only | 673 | 0.58 | 0.44 | 65% | 39% | 0.86 | — | 20.0 |
| 3-7 days | **Fitted ridge** | 1601 | 0.54 | 0.43 | 63% | 38% | 0.84 | 0.110 | 21.2 |
| 3-7 days | Rules (config) | 1601 | 0.53 | 0.42 | 54% | 42% | 0.84 | — | 22.3 |
| 3-7 days | Spread only | 1601 | 0.52 | 0.42 | 58% | 35% | 0.82 | — | 21.6 |
| 3-7 days | 538-style quality+importance | 1601 | 0.43 | 0.30 | 58% | 35% | 0.77 | — | 23.8 |
| 3-7 days | Constant base rate | 1601 | — | — | 35% | 20% | 0.50 | — | 24.6 |
| 8-14 days | **Fitted ridge** | 1601 | 0.54 | 0.42 | 63% | 37% | 0.84 | 0.111 | 21.1 |
| 8-14 days | Rules (config) | 1601 | 0.53 | 0.42 | 54% | 42% | 0.84 | — | 22.3 |
| 8-14 days | Spread only | 1601 | 0.51 | 0.40 | 58% | 36% | 0.82 | — | 21.6 |
| 8-14 days | 538-style quality+importance | 1601 | 0.42 | 0.30 | 54% | 35% | 0.77 | — | 23.8 |
| 8-14 days | Constant base rate | 1601 | — | — | 35% | 20% | 0.50 | — | 24.6 |

**Verdict (0-2 days, rules model):** roughly ties spread-only on within-day correlation (0.44 vs 0.44) and top-decile precision (58% vs 62%). Closing line available for 42% of test games.

P(Great) calibration (0-2 days, fitted):

| Predicted | n | Mean predicted | Observed |
|---|---|---|---|
| 0-5% | 517 | 3% | 4% |
| 5-10% | 295 | 7% | 12% |
| 10-15% | 286 | 12% | 15% |
| 15-20% | 237 | 18% | 17% |
| 20-30% | 263 | 23% | 29% |
| 30-100% | 3 | 32% | 0% |

Model in use: **rules**. Base rate regular 43.9 (median rating 51.1), playoff 48.1 (median 63.5); bases are the medians minus the rule terms' average contribution, so typical stakes aren't counted twice. Rules k supported by the data: 2.14.

<details><summary>Fitted coefficients (points per unit)</summary>

| Feature | Coef |
|---|---|
| closeness | 0.417 |
| quality | 1.37 |
| importance | 0 |
| stakes | 0.549 |
| style | 0.523 |
| narrative | 0.003 |
| availability | 0 |
| matchup | 0 |
| weather | 0 |
| total | 0 |
| closeAbs | -18.661 |
| closeAbs2 | -41.942 |
| intercept | 48.47 |

</details>

## WCBB

Seasons 2024, 2025, 2026 · 2229 games backfilled · tested on 2025, 2026 (trained only on earlier seasons) · 201 playoff games.

| Horizon | Model | n | Spearman | Within-day ρ | Top-10% ≥65 | Great recall (top 20%) | AUC Great vs Dull | Brier P(Great) | MAE |
|---|---|---|---|---|---|---|---|---|---|
| 0-2 days | **Fitted ridge** | 1481 | 0.59 | 0.56 | 76% | 51% | 0.88 | 0.100 | 20.5 |
| 0-2 days | Rules (config) | 1481 | 0.58 | 0.54 | 69% | 51% | 0.87 | — | 21.6 |
| 0-2 days | Spread only | 1481 | 0.50 | 0.55 | 64% | 46% | 0.83 | — | 21.6 |
| 0-2 days | 538-style quality+importance | 1481 | 0.51 | 0.40 | 58% | 43% | 0.81 | — | 24.0 |
| 0-2 days | Constant base rate | 1481 | — | — | 33% | 20% | 0.50 | — | 25.2 |
| 0-2 days, closing line | **Fitted ridge** | 580 | 0.73 | 0.63 | 80% | 46% | 0.96 | 0.125 | 19.8 |
| 0-2 days, closing line | Rules (config) | 580 | 0.64 | 0.61 | 79% | 47% | 0.91 | — | 21.5 |
| 0-2 days, closing line | Spread only | 580 | 0.75 | 0.67 | 78% | 43% | 0.97 | — | 20.8 |
| 3-7 days | **Fitted ridge** | 1481 | 0.64 | 0.52 | 70% | 48% | 0.90 | 0.099 | 20.9 |
| 3-7 days | Rules (config) | 1481 | 0.61 | 0.50 | 58% | 47% | 0.89 | — | 21.9 |
| 3-7 days | Spread only | 1481 | 0.59 | 0.52 | 60% | 44% | 0.87 | — | 21.8 |
| 3-7 days | 538-style quality+importance | 1481 | 0.50 | 0.38 | 54% | 41% | 0.80 | — | 24.0 |
| 3-7 days | Constant base rate | 1481 | — | — | 33% | 20% | 0.50 | — | 25.2 |
| 8-14 days | **Fitted ridge** | 1481 | 0.64 | 0.52 | 70% | 49% | 0.90 | 0.099 | 20.9 |
| 8-14 days | Rules (config) | 1481 | 0.61 | 0.51 | 58% | 46% | 0.89 | — | 21.9 |
| 8-14 days | Spread only | 1481 | 0.58 | 0.50 | 54% | 42% | 0.87 | — | 21.9 |
| 8-14 days | 538-style quality+importance | 1481 | 0.50 | 0.39 | 54% | 41% | 0.81 | — | 24.0 |
| 8-14 days | Constant base rate | 1481 | — | — | 33% | 20% | 0.50 | — | 25.2 |

**Verdict (0-2 days, fitted model):** roughly ties spread-only on within-day correlation (0.56 vs 0.55) and top-decile precision (76% vs 64%). Closing line available for 39% of test games.

P(Great) calibration (0-2 days, fitted):

| Predicted | n | Mean predicted | Observed |
|---|---|---|---|
| 0-5% | 679 | 2% | 4% |
| 5-10% | 198 | 7% | 12% |
| 10-15% | 164 | 12% | 16% |
| 15-20% | 135 | 18% | 21% |
| 20-30% | 204 | 24% | 21% |
| 30-100% | 101 | 34% | 43% |

Model in use: **fitted**. Base rate regular 42.8 (median rating 48.7), playoff 52.9 (median 66.0); bases are the medians minus the rule terms' average contribution, so typical stakes aren't counted twice. Rules k supported by the data: 2.13.

<details><summary>Fitted coefficients (points per unit)</summary>

| Feature | Coef |
|---|---|
| closeness | 0.378 |
| quality | 1.496 |
| importance | 0 |
| stakes | 0.751 |
| style | 1.28 |
| narrative | 0.932 |
| availability | 0 |
| matchup | 0 |
| weather | 0 |
| total | 0 |
| closeAbs | -17.605 |
| closeAbs2 | -35.391 |
| intercept | 47.65 |

</details>

## EPL

Seasons 2023, 2024, 2025 · 1140 games backfilled · tested on 2024, 2025 (trained only on earlier seasons) · 0 playoff games.

| Horizon | Model | n | Spearman | Within-day ρ | Top-10% ≥65 | Great recall (top 20%) | AUC Great vs Dull | Brier P(Great) | MAE |
|---|---|---|---|---|---|---|---|---|---|
| 0-2 days | **Fitted ridge** | 760 | 0.07 | 0.05 | 39% | 27% | 0.55 | 0.104 | 24.0 |
| 0-2 days | Rules (config) | 760 | 0.03 | 0.03 | 39% | 26% | 0.54 | — | 24.3 |
| 0-2 days | Spread only | 760 | 0.04 | 0.05 | 32% | 17% | 0.52 | — | 24.0 |
| 0-2 days | 538-style quality+importance | 760 | -0.02 | 0.03 | 36% | 30% | 0.50 | — | 24.0 |
| 0-2 days | Constant base rate | 760 | — | — | 34% | 20% | 0.50 | — | 24.0 |
| 0-2 days, closing line | **Fitted ridge** | 250 | 0.04 | -0.06 | 32% | 21% | 0.53 | 0.100 | 24.5 |
| 0-2 days, closing line | Rules (config) | 250 | 0.01 | -0.02 | 41% | 25% | 0.52 | — | 24.7 |
| 0-2 days, closing line | Spread only | 250 | 0.01 | -0.02 | 20% | 7% | 0.50 | — | 24.6 |
| 3-7 days | **Fitted ridge** | 760 | 0.09 | 0.07 | 41% | 27% | 0.57 | 0.103 | 24.0 |
| 3-7 days | Rules (config) | 760 | 0.05 | 0.04 | 42% | 27% | 0.54 | — | 24.3 |
| 3-7 days | Spread only | 760 | 0.06 | 0.05 | 34% | 18% | 0.54 | — | 24.0 |
| 3-7 days | 538-style quality+importance | 760 | -0.01 | 0.06 | 38% | 25% | 0.50 | — | 24.0 |
| 3-7 days | Constant base rate | 760 | — | — | 34% | 20% | 0.50 | — | 24.0 |
| 8-14 days | **Fitted ridge** | 760 | 0.09 | 0.07 | 46% | 27% | 0.57 | 0.103 | 24.0 |
| 8-14 days | Rules (config) | 760 | 0.05 | 0.06 | 43% | 26% | 0.54 | — | 24.2 |
| 8-14 days | Spread only | 760 | 0.06 | 0.05 | 33% | 17% | 0.54 | — | 24.0 |
| 8-14 days | 538-style quality+importance | 760 | 0.02 | 0.07 | 36% | 36% | 0.54 | — | 24.0 |
| 8-14 days | Constant base rate | 760 | — | — | 34% | 20% | 0.50 | — | 24.0 |

**Verdict (0-2 days, rules model):** roughly ties spread-only on within-day correlation (0.03 vs 0.05) and top-decile precision (39% vs 32%). Closing line available for 33% of test games.

P(Great) calibration (0-2 days, fitted):

| Predicted | n | Mean predicted | Observed |
|---|---|---|---|
| 0-5% | 0 | — | — |
| 5-10% | 4 | 10% | 0% |
| 10-15% | 617 | 13% | 12% |
| 15-20% | 136 | 16% | 11% |
| 20-30% | 3 | 21% | 33% |
| 30-100% | 0 | — | — |

Model in use: **rules**. Base rate regular 49.3 (median rating 50.0); bases are the medians minus the rule terms' average contribution, so typical stakes aren't counted twice. Rules k supported by the data: 0.22.

<details><summary>Fitted coefficients (points per unit)</summary>

| Feature | Coef |
|---|---|
| closeness | 0.051 |
| quality | 0.323 |
| importance | -0.05 |
| stakes | 0 |
| style | -0.034 |
| narrative | 0.604 |
| availability | 0 |
| matchup | 0 |
| weather | 0 |
| total | 0.03 |
| closeAbs | -2.852 |
| closeAbs2 | -9.058 |
| intercept | 49.93 |

</details>

## WSL

Seasons 2023, 2024, 2025 · 394 games backfilled · tested on 2024, 2025 (trained only on earlier seasons) · 0 playoff games.

| Horizon | Model | n | Spearman | Within-day ρ | Top-10% ≥65 | Great recall (top 20%) | AUC Great vs Dull | Brier P(Great) | MAE |
|---|---|---|---|---|---|---|---|---|---|
| 0-2 days | **Fitted ridge** | 264 | 0.20 | 0.17 | 39% | 29% | 0.64 | 0.103 | 24.3 |
| 0-2 days | Rules (config) | 264 | 0.14 | 0.24 | 39% | 35% | 0.62 | — | 24.7 |
| 0-2 days | Spread only | 264 | 0.21 | 0.21 | 25% | 35% | 0.64 | — | 24.3 |
| 0-2 days | 538-style quality+importance | 264 | 0.06 | 0.14 | 47% | 29% | 0.58 | — | 24.7 |
| 0-2 days | Constant base rate | 264 | — | — | 33% | 20% | 0.50 | — | 24.5 |
| 0-2 days, closing line | **Fitted ridge** | 68 | 0.31 | 0.37 | 43% | 50% | 0.76 | 0.059 | 25.6 |
| 0-2 days, closing line | Rules (config) | 68 | 0.06 | 0.16 | 14% | 0% | 0.56 | — | 27.3 |
| 0-2 days, closing line | Spread only | 68 | 0.30 | 0.35 | 14% | 25% | 0.68 | — | 25.8 |
| 3-7 days | **Fitted ridge** | 264 | 0.20 | 0.21 | 39% | 32% | 0.63 | 0.103 | 24.3 |
| 3-7 days | Rules (config) | 264 | 0.15 | 0.18 | 50% | 35% | 0.63 | — | 24.7 |
| 3-7 days | Spread only | 264 | 0.21 | 0.26 | 39% | 35% | 0.65 | — | 24.3 |
| 3-7 days | 538-style quality+importance | 264 | 0.04 | 0.09 | 55% | 29% | 0.56 | — | 24.7 |
| 3-7 days | Constant base rate | 264 | — | — | 33% | 20% | 0.50 | — | 24.5 |
| 8-14 days | **Fitted ridge** | 264 | 0.19 | 0.23 | 32% | 35% | 0.63 | 0.103 | 24.4 |
| 8-14 days | Rules (config) | 264 | 0.15 | 0.15 | 43% | 35% | 0.60 | — | 24.7 |
| 8-14 days | Spread only | 264 | 0.20 | 0.27 | 39% | 29% | 0.64 | — | 24.4 |
| 8-14 days | 538-style quality+importance | 264 | 0.04 | 0.11 | 44% | 29% | 0.57 | — | 24.7 |
| 8-14 days | Constant base rate | 264 | — | — | 33% | 20% | 0.50 | — | 24.5 |

**Verdict (0-2 days, rules model):** clearly beats spread-only on within-day correlation (0.24 vs 0.21) and top-decile precision (39% vs 25%). Closing line available for 26% of test games.

P(Great) calibration (0-2 days, fitted):

| Predicted | n | Mean predicted | Observed |
|---|---|---|---|
| 0-5% | 5 | 4% | 40% |
| 5-10% | 85 | 7% | 5% |
| 10-15% | 57 | 12% | 11% |
| 15-20% | 79 | 18% | 14% |
| 20-30% | 38 | 22% | 21% |
| 30-100% | 0 | — | — |

Model in use: **rules**. Base rate regular 48.7 (median rating 50.0); bases are the medians minus the rule terms' average contribution, so typical stakes aren't counted twice. Rules k supported by the data: 0.47.

<details><summary>Fitted coefficients (points per unit)</summary>

| Feature | Coef |
|---|---|
| closeness | 0.16 |
| quality | 0.141 |
| importance | -0.183 |
| stakes | 0 |
| style | 0.135 |
| narrative | 0 |
| availability | 0 |
| matchup | 0 |
| weather | 0 |
| total | -0.595 |
| closeAbs | -9.433 |
| closeAbs2 | -24.095 |
| intercept | 52.94 |

</details>

## UCL

Seasons 2023, 2024, 2025 · 503 games backfilled · tested on 2024, 2025 (trained only on earlier seasons) · 119 playoff games.

| Horizon | Model | n | Spearman | Within-day ρ | Top-10% ≥65 | Great recall (top 20%) | AUC Great vs Dull | Brier P(Great) | MAE |
|---|---|---|---|---|---|---|---|---|---|
| 0-2 days | **Fitted ridge** | 378 | 0.19 | 0.11 | 50% | 48% | 0.64 | 0.100 | 24.6 |
| 0-2 days | Rules (config) | 378 | 0.31 | 0.16 | 55% | 48% | 0.79 | — | 23.8 |
| 0-2 days | Spread only | 378 | 0.10 | 0.09 | 29% | 30% | 0.57 | — | 25.2 |
| 0-2 days | 538-style quality+importance | 378 | -0.00 | 0.00 | 39% | 28% | 0.50 | — | 25.9 |
| 0-2 days | Constant base rate | 378 | — | — | 32% | 20% | 0.50 | — | 24.9 |
| 0-2 days, closing line | **Fitted ridge** | 99 | 0.28 | 0.11 | 70% | 24% | 0.71 | 0.141 | 27.4 |
| 0-2 days, closing line | Rules (config) | 99 | 0.34 | 0.24 | 80% | 35% | 0.76 | — | 26.4 |
| 0-2 days, closing line | Spread only | 99 | 0.21 | 0.18 | 60% | 29% | 0.68 | — | 27.8 |
| 3-7 days | **Fitted ridge** | 378 | 0.18 | 0.08 | 50% | 50% | 0.66 | 0.100 | 24.7 |
| 3-7 days | Rules (config) | 378 | 0.28 | 0.12 | 50% | 46% | 0.75 | — | 23.9 |
| 3-7 days | Spread only | 378 | 0.09 | 0.07 | 39% | 30% | 0.57 | — | 25.2 |
| 3-7 days | 538-style quality+importance | 378 | 0.01 | 0.01 | 39% | 28% | 0.50 | — | 25.7 |
| 3-7 days | Constant base rate | 378 | — | — | 32% | 20% | 0.50 | — | 24.9 |
| 8-14 days | **Fitted ridge** | 378 | 0.20 | 0.08 | 55% | 48% | 0.67 | 0.099 | 24.7 |
| 8-14 days | Rules (config) | 378 | 0.28 | 0.12 | 53% | 52% | 0.76 | — | 23.8 |
| 8-14 days | Spread only | 378 | 0.09 | 0.08 | 32% | 30% | 0.58 | — | 25.2 |
| 8-14 days | 538-style quality+importance | 378 | 0.01 | 0.00 | 35% | 30% | 0.50 | — | 25.8 |
| 8-14 days | Constant base rate | 378 | — | — | 32% | 20% | 0.50 | — | 24.9 |

**Verdict (0-2 days, rules model):** clearly beats spread-only on within-day correlation (0.16 vs 0.09) and top-decile precision (55% vs 29%). Closing line available for 26% of test games.

P(Great) calibration (0-2 days, fitted):

| Predicted | n | Mean predicted | Observed |
|---|---|---|---|
| 0-5% | 115 | 3% | 7% |
| 5-10% | 114 | 7% | 11% |
| 10-15% | 76 | 12% | 9% |
| 15-20% | 26 | 17% | 19% |
| 20-30% | 27 | 24% | 22% |
| 30-100% | 20 | 40% | 40% |

Model in use: **rules**. Base rate regular 39.6 (median rating 44.9), playoff 64.0 (median 70.4); bases are the medians minus the rule terms' average contribution, so typical stakes aren't counted twice. Rules k supported by the data: 0.57.

<details><summary>Fitted coefficients (points per unit)</summary>

| Feature | Coef |
|---|---|
| closeness | 0.128 |
| quality | 0.699 |
| importance | -0.191 |
| stakes | 0.364 |
| style | 0.303 |
| narrative | 0 |
| availability | 0 |
| matchup | 0 |
| weather | 0 |
| total | 0.625 |
| closeAbs | -7.68 |
| closeAbs2 | -26.998 |
| intercept | 49.93 |

</details>

## UEL

Seasons 2023, 2024, 2025 · 519 games backfilled · tested on 2024, 2025 (trained only on earlier seasons) · 135 playoff games.

| Horizon | Model | n | Spearman | Within-day ρ | Top-10% ≥65 | Great recall (top 20%) | AUC Great vs Dull | Brier P(Great) | MAE |
|---|---|---|---|---|---|---|---|---|---|
| 0-2 days | **Fitted ridge** | 378 | 0.14 | 0.05 | 47% | 23% | 0.56 | 0.096 | 23.4 |
| 0-2 days | Rules (config) | 378 | 0.18 | 0.04 | 50% | 38% | 0.65 | — | 23.7 |
| 0-2 days | Spread only | 378 | 0.09 | 0.06 | 26% | 8% | 0.52 | — | 23.6 |
| 0-2 days | 538-style quality+importance | 378 | 0.07 | 0.07 | 31% | 18% | 0.51 | — | 23.6 |
| 0-2 days | Constant base rate | 378 | — | — | 33% | 20% | 0.50 | — | 23.6 |
| 0-2 days, closing line | **Fitted ridge** | 99 | 0.21 | 0.11 | 60% | 8% | 0.55 | 0.119 | 25.6 |
| 0-2 days, closing line | Rules (config) | 99 | 0.15 | 0.06 | 50% | 0% | 0.50 | — | 26.3 |
| 0-2 days, closing line | Spread only | 99 | 0.20 | 0.06 | 40% | 15% | 0.54 | — | 25.9 |
| 3-7 days | **Fitted ridge** | 378 | 0.10 | 0.03 | 45% | 21% | 0.54 | 0.097 | 23.5 |
| 3-7 days | Rules (config) | 378 | 0.17 | 0.02 | 50% | 36% | 0.67 | — | 23.9 |
| 3-7 days | Spread only | 378 | 0.06 | 0.04 | 34% | 8% | 0.50 | — | 23.7 |
| 3-7 days | 538-style quality+importance | 378 | 0.06 | 0.07 | 30% | 18% | 0.51 | — | 23.6 |
| 3-7 days | Constant base rate | 378 | — | — | 33% | 20% | 0.50 | — | 23.6 |
| 8-14 days | **Fitted ridge** | 378 | 0.12 | 0.05 | 47% | 21% | 0.56 | 0.096 | 23.5 |
| 8-14 days | Rules (config) | 378 | 0.17 | 0.01 | 50% | 33% | 0.68 | — | 23.9 |
| 8-14 days | Spread only | 378 | 0.08 | 0.06 | 34% | 8% | 0.53 | — | 23.7 |
| 8-14 days | 538-style quality+importance | 378 | 0.05 | 0.05 | 27% | 18% | 0.51 | — | 23.6 |
| 8-14 days | Constant base rate | 378 | — | — | 33% | 20% | 0.50 | — | 23.6 |

**Verdict (0-2 days, rules model):** roughly ties spread-only on within-day correlation (0.04 vs 0.06) and top-decile precision (50% vs 26%). Closing line available for 26% of test games.

P(Great) calibration (0-2 days, fitted):

| Predicted | n | Mean predicted | Observed |
|---|---|---|---|
| 0-5% | 10 | 4% | 20% |
| 5-10% | 35 | 8% | 6% |
| 10-15% | 83 | 13% | 5% |
| 15-20% | 234 | 18% | 13% |
| 20-30% | 16 | 22% | 6% |
| 30-100% | 0 | — | — |

Model in use: **rules**. Base rate regular 43.1 (median rating 45.3), playoff 63.9 (median 66.9); bases are the medians minus the rule terms' average contribution, so typical stakes aren't counted twice. Rules k supported by the data: 0.23.

<details><summary>Fitted coefficients (points per unit)</summary>

| Feature | Coef |
|---|---|
| closeness | 0.135 |
| quality | 0.327 |
| importance | -0.16 |
| stakes | 0.115 |
| style | -0.03 |
| narrative | 0 |
| availability | 0 |
| matchup | 0 |
| weather | 0 |
| total | -0.141 |
| closeAbs | -7.816 |
| closeAbs2 | -36.635 |
| intercept | 50.18 |

</details>

## MLS

Seasons 2024, 2025, 2026 · 1582 games backfilled · tested on 2025, 2026 (trained only on earlier seasons) · 67 playoff games.

| Horizon | Model | n | Spearman | Within-day ρ | Top-10% ≥65 | Great recall (top 20%) | AUC Great vs Dull | Brier P(Great) | MAE |
|---|---|---|---|---|---|---|---|---|---|
| 0-2 days | **Fitted ridge** | 1060 | 0.02 | 0.06 | 30% | 20% | 0.50 | 0.112 | 24.8 |
| 0-2 days | Rules (config) | 1060 | 0.09 | 0.06 | 32% | 25% | 0.56 | — | 25.0 |
| 0-2 days | Spread only | 1060 | 0.01 | 0.05 | 31% | 16% | 0.48 | — | 24.8 |
| 0-2 days | 538-style quality+importance | 1060 | -0.01 | 0.02 | 36% | 21% | 0.48 | — | 24.8 |
| 0-2 days | Constant base rate | 1060 | — | — | 33% | 20% | 0.50 | — | 24.7 |
| 0-2 days, closing line | **Fitted ridge** | 520 | 0.12 | 0.12 | 29% | 16% | 0.54 | 0.126 | 25.3 |
| 0-2 days, closing line | Rules (config) | 520 | 0.10 | 0.08 | 33% | 20% | 0.53 | — | 25.2 |
| 0-2 days, closing line | Spread only | 520 | 0.12 | 0.10 | 33% | 16% | 0.53 | — | 25.3 |
| 3-7 days | **Fitted ridge** | 1060 | 0.02 | 0.04 | 36% | 24% | 0.50 | 0.112 | 24.8 |
| 3-7 days | Rules (config) | 1060 | 0.07 | 0.04 | 34% | 25% | 0.55 | — | 25.0 |
| 3-7 days | Spread only | 1060 | 0.01 | 0.03 | 34% | 18% | 0.49 | — | 24.8 |
| 3-7 days | 538-style quality+importance | 1060 | -0.01 | 0.04 | 37% | 26% | 0.49 | — | 24.8 |
| 3-7 days | Constant base rate | 1060 | — | — | 33% | 20% | 0.50 | — | 24.7 |
| 8-14 days | **Fitted ridge** | 1060 | 0.03 | 0.03 | 38% | 24% | 0.50 | 0.112 | 24.8 |
| 8-14 days | Rules (config) | 1060 | 0.07 | 0.04 | 37% | 24% | 0.54 | — | 25.0 |
| 8-14 days | Spread only | 1060 | 0.02 | 0.04 | 39% | 19% | 0.48 | — | 24.8 |
| 8-14 days | 538-style quality+importance | 1060 | -0.02 | 0.01 | 33% | 21% | 0.47 | — | 24.8 |
| 8-14 days | Constant base rate | 1060 | — | — | 33% | 20% | 0.50 | — | 24.7 |

**Verdict (0-2 days, rules model):** roughly ties spread-only on within-day correlation (0.06 vs 0.05) and top-decile precision (32% vs 31%). Closing line available for 49% of test games.

P(Great) calibration (0-2 days, fitted):

| Predicted | n | Mean predicted | Observed |
|---|---|---|---|
| 0-5% | 0 | — | — |
| 5-10% | 245 | 9% | 13% |
| 10-15% | 769 | 12% | 12% |
| 15-20% | 16 | 17% | 6% |
| 20-30% | 21 | 24% | 38% |
| 30-100% | 9 | 41% | 22% |

Model in use: **rules**. Base rate regular 46.9 (median rating 49.2), playoff 57.9 (median 61.5); bases are the medians minus the rule terms' average contribution, so typical stakes aren't counted twice. Rules k supported by the data: 0.30.

<details><summary>Fitted coefficients (points per unit)</summary>

| Feature | Coef |
|---|---|
| closeness | 0.06 |
| quality | 0.162 |
| importance | 0.016 |
| stakes | 0.279 |
| style | -0.065 |
| narrative | 1.312 |
| availability | 0 |
| matchup | 0 |
| weather | 0 |
| total | 0.001 |
| closeAbs | -3.914 |
| closeAbs2 | -13.201 |
| intercept | 49.73 |

</details>

## NWSL

Seasons 2024, 2025, 2026 · 625 games backfilled · tested on 2025, 2026 (trained only on earlier seasons) · 21 playoff games.

| Horizon | Model | n | Spearman | Within-day ρ | Top-10% ≥65 | Great recall (top 20%) | AUC Great vs Dull | Brier P(Great) | MAE |
|---|---|---|---|---|---|---|---|---|---|
| 0-2 days | **Fitted ridge** | 436 | -0.02 | -0.02 | 45% | 19% | 0.44 | 0.119 | 25.1 |
| 0-2 days | Rules (config) | 436 | 0.10 | 0.18 | 41% | 26% | 0.58 | — | 24.9 |
| 0-2 days | Spread only | 436 | -0.03 | 0.18 | 34% | 23% | 0.43 | — | 25.2 |
| 0-2 days | 538-style quality+importance | 436 | -0.10 | -0.12 | 24% | 16% | 0.40 | — | 25.2 |
| 0-2 days | Constant base rate | 436 | — | — | 36% | 20% | 0.50 | — | 25.1 |
| 0-2 days, closing line | **Fitted ridge** | 244 | 0.02 | 0.01 | 40% | 13% | 0.52 | 0.092 | 25.0 |
| 0-2 days, closing line | Rules (config) | 244 | 0.15 | 0.27 | 40% | 33% | 0.63 | — | 24.7 |
| 0-2 days, closing line | Spread only | 244 | 0.11 | 0.36 | 44% | 33% | 0.61 | — | 25.0 |
| 3-7 days | **Fitted ridge** | 436 | -0.04 | -0.08 | 45% | 23% | 0.44 | 0.118 | 25.1 |
| 3-7 days | Rules (config) | 436 | 0.07 | 0.04 | 44% | 21% | 0.57 | — | 25.1 |
| 3-7 days | Spread only | 436 | -0.05 | 0.07 | 27% | 16% | 0.42 | — | 25.2 |
| 3-7 days | 538-style quality+importance | 436 | -0.10 | -0.09 | 40% | 16% | 0.39 | — | 25.2 |
| 3-7 days | Constant base rate | 436 | — | — | 36% | 20% | 0.50 | — | 25.1 |
| 8-14 days | **Fitted ridge** | 436 | -0.04 | -0.06 | 45% | 21% | 0.43 | 0.119 | 25.2 |
| 8-14 days | Rules (config) | 436 | 0.08 | 0.13 | 48% | 16% | 0.58 | — | 25.0 |
| 8-14 days | Spread only | 436 | -0.04 | 0.10 | 32% | 18% | 0.42 | — | 25.2 |
| 8-14 days | 538-style quality+importance | 436 | -0.09 | -0.13 | 41% | 25% | 0.40 | — | 25.2 |
| 8-14 days | Constant base rate | 436 | — | — | 36% | 20% | 0.50 | — | 25.1 |

**Verdict (0-2 days, rules model):** roughly ties spread-only on within-day correlation (0.18 vs 0.18) and top-decile precision (41% vs 34%). Closing line available for 56% of test games.

P(Great) calibration (0-2 days, fitted):

| Predicted | n | Mean predicted | Observed |
|---|---|---|---|
| 0-5% | 19 | 4% | 16% |
| 5-10% | 103 | 8% | 17% |
| 10-15% | 264 | 13% | 12% |
| 15-20% | 36 | 16% | 3% |
| 20-30% | 1 | 26% | 0% |
| 30-100% | 13 | 43% | 23% |

Model in use: **rules**. Base rate regular 46.8 (median rating 48.8), playoff 68.1 (median 71.7); bases are the medians minus the rule terms' average contribution, so typical stakes aren't counted twice. Rules k supported by the data: 0.28.

<details><summary>Fitted coefficients (points per unit)</summary>

| Feature | Coef |
|---|---|
| closeness | 0.027 |
| quality | 0.057 |
| importance | 0.051 |
| stakes | 0.744 |
| style | 0.062 |
| narrative | 0.257 |
| availability | 0 |
| matchup | 0 |
| weather | 0 |
| total | -0.27 |
| closeAbs | -1.586 |
| closeAbs2 | -12.486 |
| intercept | 49.38 |

</details>

## F1

Seasons 2023, 2024, 2025, 2026 · 91 games backfilled · tested on 2024, 2025, 2026 (trained only on earlier seasons) · 0 playoff games.

| Horizon | Model | n | Spearman | Within-day ρ | Top-10% ≥65 | Great recall (top 20%) | AUC Great vs Dull | Brier P(Great) | MAE |
|---|---|---|---|---|---|---|---|---|---|
| 0-2 days | **Fitted ridge** | 69 | -0.10 | -0.03 | 22% | 13% | 0.44 | 0.110 | 24.7 |
| 0-2 days | Rules (config) | 69 | -0.00 | -0.04 | 44% | 25% | 0.51 | — | 24.6 |
| 0-2 days | Spread only | 69 | -0.10 | — | 36% | 100% | 0.41 | — | 24.6 |
| 0-2 days | 538-style quality+importance | 69 | -0.02 | 0.16 | 44% | 13% | 0.44 | — | 24.5 |
| 0-2 days | Constant base rate | 69 | — | — | 36% | 20% | 0.50 | — | 24.4 |
| 3-7 days | **Fitted ridge** | 69 | -0.08 | 0.01 | 22% | 13% | 0.46 | 0.111 | 24.6 |
| 3-7 days | Rules (config) | 69 | 0.04 | 0.05 | 27% | 13% | 0.51 | — | 24.3 |
| 3-7 days | Spread only | 69 | -0.10 | — | 36% | 100% | 0.41 | — | 24.6 |
| 3-7 days | 538-style quality+importance | 69 | -0.02 | 0.16 | 44% | 13% | 0.44 | — | 24.5 |
| 3-7 days | Constant base rate | 69 | — | — | 36% | 20% | 0.50 | — | 24.4 |
| 8-14 days | **Fitted ridge** | 69 | -0.08 | 0.01 | 22% | 13% | 0.46 | 0.111 | 24.6 |
| 8-14 days | Rules (config) | 69 | 0.04 | 0.05 | 27% | 13% | 0.51 | — | 24.3 |
| 8-14 days | Spread only | 69 | -0.10 | — | 36% | 100% | 0.41 | — | 24.6 |
| 8-14 days | 538-style quality+importance | 69 | -0.02 | 0.16 | 44% | 13% | 0.44 | — | 24.5 |
| 8-14 days | Constant base rate | 69 | — | — | 36% | 20% | 0.50 | — | 24.4 |

**Verdict (0-2 days, rules model):** has no spread-only baseline (no lines or ratings to derive one) on within-day correlation (-0.04 vs —) and top-decile precision (44% vs 36%). Closing line available for 0% of test games.

P(Great) calibration (0-2 days, fitted):

| Predicted | n | Mean predicted | Observed |
|---|---|---|---|
| 0-5% | 6 | 3% | 0% |
| 5-10% | 31 | 8% | 19% |
| 10-15% | 21 | 12% | 10% |
| 15-20% | 6 | 17% | 0% |
| 20-30% | 5 | 26% | 0% |
| 30-100% | 0 | — | — |

Model in use: **rules**. Base rate regular 48.8 (median rating 50.0); bases are the medians minus the rule terms' average contribution, so typical stakes aren't counted twice. Rules k supported by the data: 0.88.

<details><summary>Fitted coefficients (points per unit)</summary>

| Feature | Coef |
|---|---|
| closeness | 0 |
| quality | 0.375 |
| importance | 0 |
| stakes | -0.447 |
| style | 0 |
| narrative | 0.412 |
| availability | 0 |
| matchup | -0.11 |
| weather | 0 |
| total | 0 |
| closeAbs | 0 |
| closeAbs2 | 0 |
| intercept | 49.39 |

</details>
