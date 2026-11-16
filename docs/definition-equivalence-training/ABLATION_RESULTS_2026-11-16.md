# Completed normalization, regularization and data-expansion ablations

## Current research reference

On November 16, 2026, the user selected **v7 prefix + IDF · batch 16**
(`E2_v7_bs16_prefix_idf_optionB`) as the reference for future experiments.
See [README.md](README.md) and [reference.json](reference.json) for the pinned
configuration, dataset hashes, and saved evaluation. Historical results below
remain unchanged; selection as a reference does not imply winning every metric.

All 30 saved configurations are included below. Validation: 390 pairs / 60 headwords. Test: 384 pairs / 60 headwords (121 equivalent, 263 distinct). Dictionary-only inputs; labels are agent-reviewed. These are exploratory single-seed comparisons on repeatedly inspected test data, without confidence intervals.

PR-AUC and ROC-AUC measure ranking. F1, TP/FP and conservative TP/FP use thresholds selected on validation. Diagnostic recall at test FPR <=1% uses test labels to set the threshold and is not a deployment guarantee.

| Configuration | Val PR-AUC | Test PR-AUC | Test ROC-AUC | Test F1 at val cutoff | TP / FP | TP / FP at val zero-FP cutoff | Diagnostic test R@<=1% FPR |
|---|---:|---:|---:|---:|---:|---:|---:|
| C0_base_optionB_unmasked_uniform | 0.7078 | 0.7056 | 0.8263 | 0.6220 | 79 / 54 | 20 / 4 | 16.5% |
| C1_optionB_prefix_masked_only | 0.7089 | 0.7057 | 0.8261 | 0.6100 | 79 / 59 | 20 / 4 | 16.5% |
| C2_optionB_idf_weighted_only | 0.7087 | 0.7086 | 0.8285 | 0.6224 | 75 / 45 | 20 / 4 | 16.5% |
| C3_optionB_prefix_masked_plus_idf | 0.7090 | 0.7081 | 0.8283 | 0.6224 | 75 / 45 | 20 / 4 | 16.5% |
| A0_siamese_1153d_baseline | 0.6648 | 0.6731 | 0.8114 | 0.6038 | 80 / 64 | 14 / 0 | 12.4% |
| A1_siamese_1153d_layernorm_only | 0.6406 | 0.6652 | 0.8016 | 0.6187 | 86 / 71 | 0 / 0 | 12.4% |
| A2_siamese_1153d_batchnorm_only | 0.6695 | 0.6779 | 0.7980 | 0.6093 | 85 / 73 | 14 / 2 | 15.7% |
| A3_siamese_1153d_heavy_dropout_only | 0.6658 | 0.6722 | 0.8110 | 0.6084 | 80 / 62 | 15 / 1 | 12.4% |
| A4_siamese_1153d_strong_weight_decay_only | 0.6639 | 0.6735 | 0.8114 | 0.6038 | 80 / 64 | 14 / 0 | 12.4% |
| A5_siamese_1153d_label_smoothing_only | 0.6641 | 0.6874 | 0.8150 | 0.5946 | 66 / 35 | 0 / 0 | 15.7% |
| A6_siamese_1153d_early_stopping_only | 0.6846 | 0.6801 | 0.8167 | 0.6067 | 81 / 65 | 20 / 3 | 14.0% |
| A7_siamese_low_rank_bottleneck_16d_only | 0.6098 | 0.6327 | 0.7972 | 0.5751 | 111 / 154 | 15 / 5 | 8.3% |
| A8_siamese_1153d_oof_5fold_only | 0.6385 | 0.6645 | 0.8109 | 0.6160 | 77 / 52 | 0 / 0 | 11.6% |
| A9_siamese_1153d_all_regularizations_combined | 0.6754 | 0.6763 | 0.8115 | 0.5874 | 79 / 69 | 17 / 2 | 14.0% |
| B1_finetune_higher_dropout_020_only | 0.6966 | 0.7098 | 0.8305 | 0.6167 | 70 / 36 | 19 / 3 | 15.7% |
| B2_finetune_llrd_plus_weight_decay_only | 0.7024 | 0.7037 | 0.8278 | 0.5915 | 63 / 29 | 17 / 2 | 14.0% |
| B3a_finetune_layernorm_proj_head_only | 0.7023 | 0.6980 | 0.8248 | 0.6295 | 79 / 51 | 15 / 2 | 14.9% |
| B3b_finetune_batchnorm_proj_head_only | 0.6865 | 0.6610 | 0.7957 | 0.6109 | 84 / 70 | 24 / 4 | 15.7% |
| B4_finetune_hard_negative_margin_only | 0.7127 | 0.7063 | 0.8271 | 0.6173 | 75 / 47 | 20 / 4 | 16.5% |
| B5_finetune_label_smoothing_only | 0.7095 | 0.7095 | 0.8306 | 0.6286 | 77 / 47 | 20 / 3 | 15.7% |
| B6_finetune_all_combined_optionB | 0.7042 | 0.7070 | 0.8326 | 0.6121 | 71 / 40 | 17 / 2 | 14.0% |
| D1_v6_finetune_combined_plus_prefix_idf_optionB | 0.7036 | 0.7113 | 0.8348 | 0.6094 | 71 / 41 | 18 / 2 | 14.9% |
| E1_v7_expanded_train_only_base_optionB | 0.7135 | 0.7188 | 0.8449 | 0.6271 | 74 / 41 | 19 / 2 | 16.5% |
| E2_v7_expanded_train_plus_prefix_idf_optionB | 0.7148 | 0.7217 | 0.8463 | 0.6266 | 73 / 39 | 17 / 2 | 15.7% |
| E3_v7_expanded_train_plus_regularized_siamese_mlp | 0.6879 | 0.6892 | 0.8307 | 0.6183 | 81 / 60 | 21 / 5 | 13.2% |
| E4_v7_grand_combined_finetune_plus_prefix_idf_optionB | 0.7075 | 0.7150 | 0.8460 | 0.6019 | 65 / 30 | 14 / 2 | 11.6% |
| E5_v7_grand_combined_with_regularized_siamese_mlp | 0.6801 | 0.6816 | 0.8288 | 0.5818 | 64 / 35 | 16 / 2 | 14.0% |
| E1_v7_bs16_base_optionB | 0.7208 | 0.7174 | 0.8460 | 0.6140 | 70 / 37 | 20 / 4 | 14.9% |
| E2a_v7_bs16_idf_optionB | 0.7203 | 0.7188 | 0.8468 | 0.6210 | 68 / 30 | 21 / 4 | 14.9% |
| E2_v7_bs16_prefix_idf_optionB | 0.7197 | 0.7192 | 0.8471 | 0.6210 | 68 / 30 | 21 / 4 | 14.9% |

## Conclusions

- The batch-32 comparison holds the main training settings fixed: C0 -> E1 increases test PR-AUC 0.7056 -> 0.7188 and ROC-AUC 0.8263 -> 0.8449 after increasing training pairs from 2,084 to 2,722. This is suggestive of a useful data-expansion effect, not a replicated estimate.
- The final batch-16 / lr=2e-5 / max-length-96 verification uses the original v6 architecture-benchmark baseline (test PR 0.7091, ROC 0.8309), not C0 (batch 32). Its v7 base scores are PR 0.7174 and ROC 0.8460. Do not attribute all differences between batch-16 and batch-32 rows to data alone.
- Within that final v7 verification, adding IDF gives test PR 0.7188; additionally masking the prefix gives 0.7192. The baseline has higher validation PR (0.7208) than IDF-only (0.7203) or prefix+IDF (0.7197). Test-only ranking of these tiny changes is not a basis for selecting a winner.
- The original v6 batch-16 baseline F1 is 0.6378; the v7 verification base F1 is 0.6140 and prefix+IDF is 0.6210. Better overall ranking did not yield a higher F1 at the independently validation-selected cutoff.
- Diagnostic R@<=1% test FPR is unchanged at 16.5% in the batch-32 base comparison. At the validation zero-FP cutoff, C0 and final batch-16 v7 base each make 4 test false merges; the latter catches 20/121 positives. No reliable improvement for strict automatic merging has been established.
- Normalization, dropout, weight decay and OOF stacking did not make the large coordinate-based MLP beat the simpler scorer. Label smoothing improved MLP test PR 0.6731 -> 0.6874, still below C0 0.7056. No evidence supports adding the entire regularization bundle.
- OOF means training five encoders, each excluding one group of training headwords, and using held-out outputs to train a second-stage head. This tested implementation did not improve ranking. Combining raw vectors from separately fine-tuned encoders also risks coordinate inconsistency; scalar predictions or invariant similarities are cleaner stacking inputs. OOF is not a guaranteed fix.
- Recommendation: retain the compact shared MiniLM encoder plus token matching as the research baseline. Prioritize reviewed natural equivalents and closely related negatives; use family-disjoint validation and a fresh final holdout. Evaluate several seeds before claiming small gains. A GRU or larger comparison head is not supported by these runs. No app deployment is implied.

## Five-feature prefix + IDF variant

The five inputs are pooled sentence cosine, symmetric mean token best-match, symmetric minimum token best-match, symmetric 25th-percentile token best-match, and token-count ratio. A small logistic layer combines them.

Prefix masking removes tokens through the first colon from token interaction; it does not remove them from transformer context or pooled sentence cosine. IDF weights only the mean token best-match using document frequencies from unique training texts. It uses tokenizer token IDs, including subword pieces. The minimum and quartile remain unweighted; the length ratio changes with masking. These are scoring features, not extra transformer layers.
