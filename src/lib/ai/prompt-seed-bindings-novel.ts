import type { PromptApplicability, PromptVariableBinding } from '../types/prompt'

export interface NovelPromptSeedBinding {
  assetId: string
  variableBindings: PromptVariableBinding[]
  applicability?: PromptApplicability
}

export const NOVEL_PROMPT_SEED_BINDINGS: Record<string, NovelPromptSeedBinding> = {
  "P00-A": {
    "assetId": "P00-A",
    "variableBindings": [
      {
        "variable": "raw_intent",
        "label": "作者原始想法",
        "manual": true,
        "required": true,
        "placeholder": "请输入本任务需要的材料"
      },
      {
        "variable": "existing_materials",
        "label": "已有材料",
        "manual": true,
        "required": false,
        "placeholder": "请输入本任务需要的材料"
      },
      {
        "variable": "explicit_constraints",
        "label": "明确约束",
        "sourceKeys": [
          "creativeRules",
          "userStyleProfile"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "length_mode",
        "label": "篇幅模式",
        "projectField": "lengthMode",
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "serialization_mode",
        "label": "连载模式",
        "projectField": "serializationMode",
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "genre_candidates",
        "label": "候选题材",
        "projectField": "genres",
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "target_readers",
        "label": "目标读者",
        "manual": true,
        "required": false,
        "placeholder": "请输入本任务需要的材料"
      },
      {
        "variable": "delivery_form",
        "label": "交付形态",
        "manual": true,
        "required": false,
        "placeholder": "请输入本任务需要的材料"
      }
    ]
  },
  "P01-A": {
    "assetId": "P01-A",
    "variableBindings": [
      {
        "variable": "materials",
        "label": "输入材料",
        "manual": true,
        "required": false,
        "placeholder": "请输入本任务需要的材料"
      },
      {
        "variable": "author_direction",
        "label": "作者方向",
        "manual": true,
        "required": false,
        "placeholder": "请输入本任务需要的材料"
      }
    ]
  },
  "P02-A": {
    "assetId": "P02-A",
    "variableBindings": [
      {
        "variable": "story_direction",
        "label": "故事 · 方向",
        "sourceKeys": [
          "storyCore"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "length_mode",
        "label": "篇幅模式",
        "projectField": "lengthMode",
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "delivery_mode",
        "label": "交付 · 模式",
        "projectField": "serializationMode",
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "author_preferences",
        "label": "作者 · 偏好",
        "sourceKeys": [
          "creativeRules",
          "userStyleProfile"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "candidate_genres",
        "label": "候选题材",
        "projectField": "genres",
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      }
    ]
  },
  "P03-A": {
    "assetId": "P03-A",
    "variableBindings": [
      {
        "variable": "creative_brief",
        "label": "创作简报",
        "sourceKeys": [
          "storyCore"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "genre_promise",
        "label": "类型与读者承诺",
        "sourceKeys": [
          "storyCore"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "candidate_ideas",
        "label": "候选故事概念",
        "manual": true,
        "required": true,
        "placeholder": "请输入本任务需要的材料"
      },
      {
        "variable": "author_nonnegotiables",
        "label": "不可妥协项",
        "sourceKeys": [
          "creativeRules",
          "userStyleProfile"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      }
    ]
  },
  "P04-A": {
    "assetId": "P04-A",
    "variableBindings": [
      {
        "variable": "story_core",
        "label": "故事核心",
        "sourceKeys": [
          "storyCore"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "time_place",
        "label": "时间与地点",
        "sourceKeys": [
          "locations",
          "worldview"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "key_scenes",
        "label": "关键 · 场景",
        "sourceKeys": [
          "existingVolumeOutlines",
          "storyArcs",
          "chapterOutline",
          "detailedOutline"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "domains",
        "label": "影响领域",
        "manual": true,
        "required": false,
        "placeholder": "请输入本任务需要的材料"
      },
      {
        "variable": "fictionalization",
        "label": "架空改造范围",
        "manual": true,
        "required": false,
        "placeholder": "请输入本任务需要的材料"
      },
      {
        "variable": "existing_sources",
        "label": "已有资料来源",
        "manual": true,
        "required": false,
        "placeholder": "请输入本任务需要的材料"
      }
    ]
  },
  "P04-B": {
    "assetId": "P04-B",
    "variableBindings": [
      {
        "variable": "question",
        "label": "核心问题",
        "sourceKeys": [
          "storyCore"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "source_records",
        "label": "来源记录",
        "manual": true,
        "required": true,
        "placeholder": "请输入本任务需要的材料"
      },
      {
        "variable": "story_use",
        "label": "故事 · 剧情用途",
        "sourceKeys": [
          "storyCore"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      }
    ]
  },
  "P04-C": {
    "assetId": "P04-C",
    "variableBindings": [
      {
        "variable": "verified_facts",
        "label": "已核验 · 已确认事实",
        "sourceKeys": [
          "chapterContinuityHandoff",
          "previousPlanReconciliation",
          "recentChapterSummaries",
          "currentFacts",
          "stateCards",
          "heldItems",
          "itemLedger",
          "storyTimeline",
          "foreshadows"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "characters_goals",
        "label": "角色 · 目标",
        "sourceKeys": [
          "characters",
          "characterRelations",
          "stateCards"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "planned_scene",
        "label": "原计划 · 场景",
        "sourceKeys": [
          "existingVolumeOutlines",
          "storyArcs",
          "chapterOutline",
          "detailedOutline"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "pov",
        "label": "视角",
        "sourceKeys": [
          "characters",
          "characterRelations",
          "stateCards"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      }
    ]
  },
  "P05-A": {
    "assetId": "P05-A",
    "variableBindings": [
      {
        "variable": "story_core",
        "label": "故事核心",
        "sourceKeys": [
          "storyCore"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "characters",
        "label": "角色资料",
        "sourceKeys": [
          "characters",
          "characterRelations",
          "stateCards"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "genre_promise",
        "label": "类型与读者承诺",
        "sourceKeys": [
          "storyCore"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "research_boundary",
        "label": "考证 · 边界",
        "sourceKeys": [
          "existingVolumeOutlines",
          "storyArcs",
          "chapterOutline",
          "detailedOutline"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "existing_world",
        "label": "已有 · 世界观",
        "sourceKeys": [
          "worldview",
          "worldRules",
          "powerSystem",
          "codex",
          "historical",
          "locations"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      }
    ]
  },
  "P05-B": {
    "assetId": "P05-B",
    "variableBindings": [
      {
        "variable": "world_material",
        "label": "世界观 · 材料",
        "sourceKeys": [
          "worldview",
          "worldRules",
          "powerSystem",
          "codex",
          "historical",
          "locations"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "story_needs",
        "label": "故事 · 叙事需求",
        "sourceKeys": [
          "storyCore"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "fiction_rules",
        "label": "虚构 · 规则",
        "sourceKeys": [
          "worldview",
          "worldRules",
          "powerSystem",
          "codex",
          "historical",
          "locations"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      }
    ]
  },
  "P05-C": {
    "assetId": "P05-C",
    "variableBindings": [
      {
        "variable": "society_rules",
        "label": "社会 · 规则",
        "sourceKeys": [
          "worldview",
          "worldRules",
          "powerSystem",
          "codex",
          "historical",
          "locations"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "history",
        "label": "历史",
        "sourceKeys": [
          "worldview",
          "worldRules",
          "powerSystem",
          "codex",
          "historical",
          "locations"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "characters_positions",
        "label": "角色 · 处境",
        "sourceKeys": [
          "characters",
          "characterRelations",
          "stateCards"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      }
    ]
  },
  "P05-D": {
    "assetId": "P05-D",
    "variableBindings": [
      {
        "variable": "world_rules",
        "label": "世界规则",
        "sourceKeys": [
          "worldview",
          "worldRules",
          "powerSystem",
          "codex",
          "historical",
          "locations"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "world_details",
        "label": "世界观 · 细节",
        "sourceKeys": [
          "worldview",
          "worldRules",
          "powerSystem",
          "codex",
          "historical",
          "locations"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "plot_requirements",
        "label": "剧情 · 需求",
        "sourceKeys": [
          "existingVolumeOutlines",
          "storyArcs",
          "chapterOutline",
          "detailedOutline"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      }
    ]
  },
  "P06-A": {
    "assetId": "P06-A",
    "variableBindings": [
      {
        "variable": "story_core",
        "label": "故事核心",
        "sourceKeys": [
          "storyCore"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "world_pressure",
        "label": "世界观 · 压力",
        "sourceKeys": [
          "worldview",
          "worldRules",
          "powerSystem",
          "codex",
          "historical",
          "locations"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "character",
        "label": "当前角色",
        "sourceKeys": [
          "characters",
          "characterRelations",
          "stateCards"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "story_role",
        "label": "故事 · 剧情作用",
        "sourceKeys": [
          "storyCore"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      }
    ]
  },
  "P06-B": {
    "assetId": "P06-B",
    "variableBindings": [
      {
        "variable": "protagonist",
        "label": "主角资料",
        "sourceKeys": [
          "characters",
          "characterRelations",
          "stateCards"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "central_conflict",
        "label": "中心 · 冲突",
        "sourceKeys": [
          "storyCore"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "world_rules",
        "label": "世界规则",
        "sourceKeys": [
          "worldview",
          "worldRules",
          "powerSystem",
          "codex",
          "historical",
          "locations"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "antagonist",
        "label": "对抗方资料",
        "sourceKeys": [
          "characters",
          "characterRelations",
          "stateCards"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      }
    ]
  },
  "P06-C": {
    "assetId": "P06-C",
    "variableBindings": [
      {
        "variable": "core_characters",
        "label": "核心 · 角色",
        "sourceKeys": [
          "characters",
          "characterRelations",
          "stateCards"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "plot_lines",
        "label": "剧情 · 剧情线",
        "sourceKeys": [
          "existingVolumeOutlines",
          "storyArcs",
          "chapterOutline",
          "detailedOutline"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "supporting_characters",
        "label": "配角 · 角色",
        "sourceKeys": [
          "characters",
          "characterRelations",
          "stateCards"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      }
    ]
  },
  "P06-D": {
    "assetId": "P06-D",
    "variableBindings": [
      {
        "variable": "character_core",
        "label": "角色 · 核心",
        "sourceKeys": [
          "characters",
          "characterRelations",
          "stateCards"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "major_plot_turns",
        "label": "关键 · 剧情 · 转折",
        "sourceKeys": [
          "existingVolumeOutlines",
          "storyArcs",
          "chapterOutline",
          "detailedOutline"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "written_facts",
        "label": "已写 · 已确认事实",
        "sourceKeys": [
          "chapterContinuityHandoff",
          "previousPlanReconciliation",
          "recentChapterSummaries",
          "currentFacts",
          "stateCards",
          "heldItems",
          "itemLedger",
          "storyTimeline",
          "foreshadows"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      }
    ]
  },
  "P07-A": {
    "assetId": "P07-A",
    "variableBindings": [
      {
        "variable": "story_core",
        "label": "故事核心",
        "sourceKeys": [
          "storyCore"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "characters",
        "label": "角色资料",
        "sourceKeys": [
          "characters",
          "characterRelations",
          "stateCards"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "world_constraints",
        "label": "世界观 · 约束",
        "sourceKeys": [
          "worldview",
          "worldRules",
          "powerSystem",
          "codex",
          "historical",
          "locations"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "length_mode",
        "label": "篇幅模式",
        "projectField": "lengthMode",
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      }
    ]
  },
  "P07-B": {
    "assetId": "P07-B",
    "variableBindings": [
      {
        "variable": "plot_engine",
        "label": "剧情 · 发动机",
        "sourceKeys": [
          "existingVolumeOutlines",
          "storyArcs",
          "chapterOutline",
          "detailedOutline"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "resources",
        "label": "资源",
        "sourceKeys": [
          "worldview",
          "worldRules",
          "powerSystem",
          "codex",
          "historical",
          "locations"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "turns",
        "label": "转折",
        "sourceKeys": [
          "existingVolumeOutlines",
          "storyArcs",
          "chapterOutline",
          "detailedOutline"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      }
    ]
  },
  "P07-C": {
    "assetId": "P07-C",
    "variableBindings": [
      {
        "variable": "story_truth",
        "label": "故事 · 事实真相",
        "sourceKeys": [
          "storyCore"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "pov_plan",
        "label": "视角 · plan",
        "sourceKeys": [
          "characters",
          "characterRelations",
          "stateCards"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "plot_turns",
        "label": "剧情 · 转折",
        "sourceKeys": [
          "existingVolumeOutlines",
          "storyArcs",
          "chapterOutline",
          "detailedOutline"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      }
    ]
  },
  "P07-D": {
    "assetId": "P07-D",
    "variableBindings": [
      {
        "variable": "main_plot",
        "label": "主线 · 剧情",
        "sourceKeys": [
          "existingVolumeOutlines",
          "storyArcs",
          "chapterOutline",
          "detailedOutline"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "subplots",
        "label": "复线",
        "sourceKeys": [
          "existingVolumeOutlines",
          "storyArcs",
          "chapterOutline",
          "detailedOutline"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "character_arcs",
        "label": "角色 · 人物弧",
        "sourceKeys": [
          "characters",
          "characterRelations",
          "stateCards"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "length_mode",
        "label": "篇幅模式",
        "projectField": "lengthMode",
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      }
    ]
  },
  "P08-A": {
    "assetId": "P08-A",
    "variableBindings": [
      {
        "variable": "story_core",
        "label": "故事核心",
        "sourceKeys": [
          "storyCore"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "character_arcs",
        "label": "角色 · 人物弧",
        "sourceKeys": [
          "characters",
          "characterRelations",
          "stateCards"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "world_and_constraints",
        "label": "世界观 · and · 约束",
        "sourceKeys": [
          "worldview",
          "worldRules",
          "powerSystem",
          "codex",
          "historical",
          "locations"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "genre_promise",
        "label": "类型与读者承诺",
        "sourceKeys": [
          "storyCore"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "length_mode",
        "label": "篇幅模式",
        "projectField": "lengthMode",
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "delivery_mode",
        "label": "交付 · 模式",
        "projectField": "serializationMode",
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "target_words",
        "label": "目标字数",
        "manual": true,
        "required": true,
        "placeholder": "请输入本任务需要的材料"
      },
      {
        "variable": "known_ending",
        "label": "已知 · 结局",
        "sourceKeys": [
          "existingVolumeOutlines",
          "storyArcs",
          "chapterOutline",
          "detailedOutline"
        ],
        "manual": true,
        "required": true,
        "placeholder": "可补充或修正自动读取的项目资料"
      }
    ]
  },
  "P09L-A": {
    "assetId": "P09L-A",
    "variableBindings": [
      {
        "variable": "story_core",
        "label": "故事核心",
        "sourceKeys": [
          "storyCore"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "major_turns",
        "label": "关键 · 转折",
        "sourceKeys": [
          "existingVolumeOutlines",
          "storyArcs",
          "chapterOutline",
          "detailedOutline"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "character_arcs",
        "label": "角色 · 人物弧",
        "sourceKeys": [
          "characters",
          "characterRelations",
          "stateCards"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "plot_lines",
        "label": "剧情 · 剧情线",
        "sourceKeys": [
          "existingVolumeOutlines",
          "storyArcs",
          "chapterOutline",
          "detailedOutline"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "target_length",
        "label": "目标篇幅",
        "manual": true,
        "required": false,
        "placeholder": "请输入本任务需要的材料"
      },
      {
        "variable": "written_progress",
        "label": "已写 · 进展",
        "sourceKeys": [
          "chapterContinuityHandoff",
          "previousPlanReconciliation",
          "recentChapterSummaries",
          "currentFacts",
          "stateCards",
          "heldItems",
          "itemLedger",
          "storyTimeline",
          "foreshadows"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      }
    ],
    "applicability": {
      "lengthModes": [
        "long"
      ]
    }
  },
  "P09L-B": {
    "assetId": "P09L-B",
    "variableBindings": [
      {
        "variable": "outline",
        "label": "大纲",
        "sourceKeys": [
          "existingVolumeOutlines",
          "storyArcs",
          "chapterOutline",
          "detailedOutline"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "genre_promise",
        "label": "类型与读者承诺",
        "sourceKeys": [
          "storyCore"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "foreshadows",
        "label": "伏笔状态",
        "sourceKeys": [
          "existingVolumeOutlines",
          "storyArcs",
          "chapterOutline",
          "detailedOutline"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      }
    ],
    "applicability": {
      "lengthModes": [
        "long"
      ]
    }
  },
  "P09L-C": {
    "assetId": "P09L-C",
    "variableBindings": [
      {
        "variable": "before_middle",
        "label": "之前 · 中段",
        "sourceKeys": [
          "chapterContent"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "middle",
        "label": "中段设计",
        "manual": true,
        "required": false,
        "placeholder": "请输入本任务需要的材料"
      },
      {
        "variable": "after_middle",
        "label": "之后 · 中段",
        "sourceKeys": [
          "chapterContent"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "character_states",
        "label": "角色 · 状态",
        "sourceKeys": [
          "chapterContinuityHandoff",
          "previousPlanReconciliation",
          "recentChapterSummaries",
          "currentFacts",
          "stateCards",
          "heldItems",
          "itemLedger",
          "storyTimeline",
          "foreshadows"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      }
    ],
    "applicability": {
      "lengthModes": [
        "long"
      ]
    }
  },
  "P09L-D": {
    "assetId": "P09L-D",
    "variableBindings": [
      {
        "variable": "plots",
        "label": "剧情线",
        "sourceKeys": [
          "existingVolumeOutlines",
          "storyArcs",
          "chapterOutline",
          "detailedOutline"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "promises",
        "label": "读者承诺",
        "sourceKeys": [
          "storyCore"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "character_arcs",
        "label": "角色 · 人物弧",
        "sourceKeys": [
          "characters",
          "characterRelations",
          "stateCards"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "ending",
        "label": "结局",
        "sourceKeys": [
          "existingVolumeOutlines",
          "storyArcs",
          "chapterOutline",
          "detailedOutline"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      }
    ],
    "applicability": {
      "lengthModes": [
        "long"
      ]
    }
  },
  "P09S-A": {
    "assetId": "P09S-A",
    "variableBindings": [
      {
        "variable": "idea",
        "label": "核心想法",
        "manual": true,
        "required": false,
        "placeholder": "请输入本任务需要的材料"
      },
      {
        "variable": "target_words",
        "label": "目标字数",
        "manual": true,
        "required": true,
        "placeholder": "请输入本任务需要的材料"
      },
      {
        "variable": "emotion_or_insight",
        "label": "核心情绪或认知变化",
        "manual": true,
        "required": false,
        "placeholder": "请输入本任务需要的材料"
      },
      {
        "variable": "rules",
        "label": "规则",
        "sourceKeys": [
          "creativeRules",
          "userStyleProfile"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      }
    ],
    "applicability": {
      "lengthModes": [
        "short"
      ]
    }
  },
  "P09S-B": {
    "assetId": "P09S-B",
    "variableBindings": [
      {
        "variable": "text",
        "label": "当前文本",
        "sourceKeys": [
          "chapterContent"
        ],
        "manual": true,
        "required": true,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "core_change",
        "label": "核心 · 变化",
        "sourceKeys": [
          "storyCore"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "target_words",
        "label": "目标字数",
        "manual": true,
        "required": true,
        "placeholder": "请输入本任务需要的材料"
      }
    ],
    "applicability": {
      "lengthModes": [
        "short"
      ]
    }
  },
  "P09S-C": {
    "assetId": "P09S-C",
    "variableBindings": [
      {
        "variable": "events",
        "label": "关键事件",
        "sourceKeys": [
          "existingVolumeOutlines",
          "storyArcs",
          "chapterOutline",
          "detailedOutline"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "pov",
        "label": "视角",
        "sourceKeys": [
          "characters",
          "characterRelations",
          "stateCards"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "ending",
        "label": "结局",
        "sourceKeys": [
          "existingVolumeOutlines",
          "storyArcs",
          "chapterOutline",
          "detailedOutline"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      }
    ],
    "applicability": {
      "lengthModes": [
        "short"
      ]
    }
  },
  "P09S-D": {
    "assetId": "P09S-D",
    "variableBindings": [
      {
        "variable": "story",
        "label": "故事",
        "sourceKeys": [
          "storyCore"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "core_change",
        "label": "核心 · 变化",
        "sourceKeys": [
          "storyCore"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "effect",
        "label": "目标效果",
        "manual": true,
        "required": false,
        "placeholder": "请输入本任务需要的材料"
      }
    ],
    "applicability": {
      "lengthModes": [
        "short"
      ]
    }
  },
  "P09R-A": {
    "assetId": "P09R-A",
    "variableBindings": [
      {
        "variable": "outline",
        "label": "大纲",
        "sourceKeys": [
          "existingVolumeOutlines",
          "storyArcs",
          "chapterOutline",
          "detailedOutline"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "genre_promise",
        "label": "类型与读者承诺",
        "sourceKeys": [
          "storyCore"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "range",
        "label": "叙事范围",
        "manual": true,
        "required": false,
        "placeholder": "请输入本任务需要的材料"
      },
      {
        "variable": "parameters",
        "label": "运行参数",
        "manual": true,
        "required": false,
        "placeholder": "请输入本任务需要的材料"
      }
    ],
    "applicability": {
      "serializationModes": [
        "serial"
      ]
    }
  },
  "P09R-B": {
    "assetId": "P09R-B",
    "variableBindings": [
      {
        "variable": "chapter",
        "label": "章节",
        "sourceKeys": [
          "chapterContent"
        ],
        "manual": true,
        "required": true,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "next",
        "label": "下一步计划",
        "manual": true,
        "required": false,
        "placeholder": "请输入本任务需要的材料"
      },
      {
        "variable": "reader_question",
        "label": "读者 · 核心问题",
        "sourceKeys": [
          "storyCore"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      }
    ],
    "applicability": {
      "serializationModes": [
        "serial"
      ]
    }
  },
  "P09R-C": {
    "assetId": "P09R-C",
    "variableBindings": [
      {
        "variable": "update_goal",
        "label": "本次更新目标",
        "manual": true,
        "required": false,
        "placeholder": "请输入本任务需要的材料"
      },
      {
        "variable": "capacity",
        "label": "创作产能",
        "manual": true,
        "required": false,
        "placeholder": "请输入本任务需要的材料"
      },
      {
        "variable": "backlog",
        "label": "待处理问题",
        "manual": true,
        "required": false,
        "placeholder": "请输入本任务需要的材料"
      },
      {
        "variable": "revision_time",
        "label": "修订时间预算",
        "manual": true,
        "required": false,
        "placeholder": "请输入本任务需要的材料"
      },
      {
        "variable": "constraints",
        "label": "约束",
        "sourceKeys": [
          "creativeRules",
          "userStyleProfile"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      }
    ],
    "applicability": {
      "serializationModes": [
        "serial"
      ]
    }
  },
  "P09R-D": {
    "assetId": "P09R-D",
    "variableBindings": [
      {
        "variable": "feedback",
        "label": "读者反馈",
        "manual": true,
        "required": false,
        "placeholder": "请输入本任务需要的材料"
      },
      {
        "variable": "promise",
        "label": "读者承诺",
        "sourceKeys": [
          "storyCore"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "intent",
        "label": "创作意图",
        "manual": true,
        "required": false,
        "placeholder": "请输入本任务需要的材料"
      },
      {
        "variable": "facts",
        "label": "已确认事实",
        "sourceKeys": [
          "chapterContinuityHandoff",
          "previousPlanReconciliation",
          "recentChapterSummaries",
          "currentFacts",
          "stateCards",
          "heldItems",
          "itemLedger",
          "storyTimeline",
          "foreshadows"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      }
    ],
    "applicability": {
      "serializationModes": [
        "serial"
      ]
    }
  },
  "P10-A": {
    "assetId": "P10-A",
    "variableBindings": [
      {
        "variable": "volume_goal",
        "label": "卷级 · goal",
        "sourceKeys": [
          "existingVolumeOutlines",
          "storyArcs",
          "chapterOutline",
          "detailedOutline"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "chapter_outline",
        "label": "当前章纲",
        "sourceKeys": [
          "existingVolumeOutlines",
          "storyArcs",
          "chapterOutline",
          "detailedOutline"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "previous_actual",
        "label": "上一阶段 · 实际进展",
        "sourceKeys": [
          "chapterContinuityHandoff",
          "previousPlanReconciliation",
          "recentChapterSummaries",
          "currentFacts",
          "stateCards",
          "heldItems",
          "itemLedger",
          "storyTimeline",
          "foreshadows"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "next_plan",
        "label": "下一步 · plan",
        "sourceKeys": [
          "existingVolumeOutlines",
          "storyArcs",
          "chapterOutline",
          "detailedOutline"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "states",
        "label": "状态",
        "sourceKeys": [
          "chapterContinuityHandoff",
          "previousPlanReconciliation",
          "recentChapterSummaries",
          "currentFacts",
          "stateCards",
          "heldItems",
          "itemLedger",
          "storyTimeline",
          "foreshadows"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      }
    ]
  },
  "P10-B": {
    "assetId": "P10-B",
    "variableBindings": [
      {
        "variable": "chapter_task",
        "label": "章节任务",
        "sourceKeys": [
          "existingVolumeOutlines",
          "storyArcs",
          "chapterOutline",
          "detailedOutline"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "location",
        "label": "地点约束",
        "sourceKeys": [
          "locations",
          "worldview"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "participants",
        "label": "出场角色",
        "sourceKeys": [
          "characters",
          "characterRelations",
          "stateCards"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      }
    ]
  },
  "P10-C": {
    "assetId": "P10-C",
    "variableBindings": [
      {
        "variable": "result",
        "label": "上一结果",
        "manual": true,
        "required": false,
        "placeholder": "请输入本任务需要的材料"
      },
      {
        "variable": "state",
        "label": "状态",
        "sourceKeys": [
          "chapterContinuityHandoff",
          "previousPlanReconciliation",
          "recentChapterSummaries",
          "currentFacts",
          "stateCards",
          "heldItems",
          "itemLedger",
          "storyTimeline",
          "foreshadows"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "pace",
        "label": "节奏目标",
        "manual": true,
        "required": false,
        "placeholder": "请输入本任务需要的材料"
      },
      {
        "variable": "next",
        "label": "下一步计划",
        "manual": true,
        "required": false,
        "placeholder": "请输入本任务需要的材料"
      }
    ]
  },
  "P10-D": {
    "assetId": "P10-D",
    "variableBindings": [
      {
        "variable": "scenes",
        "label": "场景",
        "sourceKeys": [
          "existingVolumeOutlines",
          "storyArcs",
          "chapterOutline",
          "detailedOutline"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "baseline",
        "label": "当前基线",
        "sourceKeys": [
          "existingVolumeOutlines",
          "storyArcs",
          "chapterOutline",
          "detailedOutline",
          "characters",
          "characterRelations",
          "stateCards",
          "chapterContinuityHandoff",
          "previousPlanReconciliation",
          "recentChapterSummaries",
          "currentFacts",
          "stateCards",
          "heldItems",
          "itemLedger",
          "storyTimeline",
          "foreshadows"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "target_arc",
        "label": "目标 · 人物弧",
        "sourceKeys": [
          "existingVolumeOutlines",
          "storyArcs",
          "chapterOutline",
          "detailedOutline"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      }
    ]
  },
  "P10-E": {
    "assetId": "P10-E",
    "variableBindings": [
      {
        "variable": "summary",
        "label": "章节或故事摘要",
        "sourceKeys": [
          "existingVolumeOutlines",
          "storyArcs",
          "chapterOutline",
          "detailedOutline"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "style",
        "label": "文风规则",
        "sourceKeys": [
          "creativeRules",
          "userStyleProfile"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "neighbors",
        "label": "相邻章节标题",
        "sourceKeys": [
          "existingVolumeOutlines",
          "storyArcs",
          "chapterOutline",
          "detailedOutline"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      }
    ]
  },
  "P11-A": {
    "assetId": "P11-A",
    "variableBindings": [
      {
        "variable": "brief",
        "label": "创作简报",
        "sourceKeys": [
          "storyCore"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "core",
        "label": "故事核心",
        "sourceKeys": [
          "storyCore"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "plan",
        "label": "当前计划",
        "sourceKeys": [
          "existingVolumeOutlines",
          "storyArcs",
          "chapterOutline",
          "detailedOutline"
        ],
        "manual": true,
        "required": true,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "characters",
        "label": "角色资料",
        "sourceKeys": [
          "characters",
          "characterRelations",
          "stateCards"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "world",
        "label": "世界观与规则",
        "sourceKeys": [
          "worldview",
          "worldRules",
          "powerSystem",
          "codex",
          "historical",
          "locations"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "style",
        "label": "文风规则",
        "sourceKeys": [
          "creativeRules",
          "userStyleProfile"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "words",
        "label": "目标字数",
        "manual": true,
        "required": true,
        "placeholder": "请输入本任务需要的材料"
      }
    ]
  },
  "P11-B": {
    "assetId": "P11-B",
    "variableBindings": [
      {
        "variable": "task",
        "label": "章节任务",
        "sourceKeys": [
          "existingVolumeOutlines",
          "storyArcs",
          "chapterOutline",
          "detailedOutline"
        ],
        "manual": true,
        "required": true,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "scenes",
        "label": "场景",
        "sourceKeys": [
          "existingVolumeOutlines",
          "storyArcs",
          "chapterOutline",
          "detailedOutline"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "continuity",
        "label": "连续性资料",
        "sourceKeys": [
          "chapterContinuityHandoff",
          "previousPlanReconciliation",
          "recentChapterSummaries",
          "currentFacts",
          "stateCards",
          "heldItems",
          "itemLedger",
          "storyTimeline",
          "foreshadows"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "voices",
        "label": "角色语言",
        "sourceKeys": [
          "characters",
          "characterRelations",
          "stateCards"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "rules",
        "label": "规则",
        "sourceKeys": [
          "worldview",
          "worldRules",
          "powerSystem",
          "codex",
          "creativeRules",
          "userStyleProfile"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "instruction",
        "label": "本次指令",
        "manual": true,
        "required": false,
        "placeholder": "请输入本任务需要的材料"
      },
      {
        "variable": "words",
        "label": "目标字数",
        "manual": true,
        "required": true,
        "placeholder": "请输入本任务需要的材料"
      }
    ]
  },
  "P11-C": {
    "assetId": "P11-C",
    "variableBindings": [
      {
        "variable": "text",
        "label": "当前文本",
        "sourceKeys": [
          "chapterContent"
        ],
        "manual": true,
        "required": true,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "handoff",
        "label": "章节交接",
        "sourceKeys": [
          "chapterContinuityHandoff",
          "previousPlanReconciliation",
          "recentChapterSummaries",
          "currentFacts",
          "stateCards",
          "heldItems",
          "itemLedger",
          "storyTimeline",
          "foreshadows"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "next_task",
        "label": "下一步 · 任务",
        "sourceKeys": [
          "existingVolumeOutlines",
          "storyArcs",
          "chapterOutline",
          "detailedOutline"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "continuity",
        "label": "连续性资料",
        "sourceKeys": [
          "chapterContinuityHandoff",
          "previousPlanReconciliation",
          "recentChapterSummaries",
          "currentFacts",
          "stateCards",
          "heldItems",
          "itemLedger",
          "storyTimeline",
          "foreshadows"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "style",
        "label": "文风规则",
        "sourceKeys": [
          "creativeRules",
          "userStyleProfile"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "words",
        "label": "目标字数",
        "manual": true,
        "required": true,
        "placeholder": "请输入本任务需要的材料"
      }
    ]
  },
  "P11-D": {
    "assetId": "P11-D",
    "variableBindings": [
      {
        "variable": "goal",
        "label": "本次目标",
        "manual": true,
        "required": true,
        "placeholder": "请输入本任务需要的材料"
      },
      {
        "variable": "participants",
        "label": "出场角色",
        "sourceKeys": [
          "characters",
          "characterRelations",
          "stateCards"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "knowledge",
        "label": "人物信息边界",
        "sourceKeys": [
          "characters",
          "characterRelations",
          "currentFacts"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "relationship",
        "label": "人物关系",
        "sourceKeys": [
          "characters",
          "characterRelations",
          "stateCards"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "setting",
        "label": "场景环境",
        "sourceKeys": [
          "locations",
          "worldview"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      }
    ]
  },
  "P11-E": {
    "assetId": "P11-E",
    "variableBindings": [
      {
        "variable": "goal",
        "label": "本次目标",
        "manual": true,
        "required": true,
        "placeholder": "请输入本任务需要的材料"
      },
      {
        "variable": "space",
        "label": "空间布局",
        "sourceKeys": [
          "locations",
          "worldview"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "states",
        "label": "状态",
        "sourceKeys": [
          "chapterContinuityHandoff",
          "previousPlanReconciliation",
          "recentChapterSummaries",
          "currentFacts",
          "stateCards",
          "heldItems",
          "itemLedger",
          "storyTimeline",
          "foreshadows"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "abilities",
        "label": "能力",
        "sourceKeys": [
          "characters",
          "characterRelations",
          "stateCards"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "outcome",
        "label": "结果约束",
        "manual": true,
        "required": false,
        "placeholder": "请输入本任务需要的材料"
      }
    ]
  },
  "P11-F": {
    "assetId": "P11-F",
    "variableBindings": [
      {
        "variable": "goal",
        "label": "本次目标",
        "manual": true,
        "required": true,
        "placeholder": "请输入本任务需要的材料"
      },
      {
        "variable": "state",
        "label": "状态",
        "sourceKeys": [
          "chapterContinuityHandoff",
          "previousPlanReconciliation",
          "recentChapterSummaries",
          "currentFacts",
          "stateCards",
          "heldItems",
          "itemLedger",
          "storyTimeline",
          "foreshadows"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "world",
        "label": "世界观与规则",
        "sourceKeys": [
          "worldview",
          "worldRules",
          "powerSystem",
          "codex",
          "historical",
          "locations"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "time",
        "label": "时间跨度",
        "sourceKeys": [
          "storyTimeline",
          "historical"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "draft",
        "label": "待修订文本",
        "sourceKeys": [
          "chapterContent"
        ],
        "manual": true,
        "required": true,
        "placeholder": "可补充或修正自动读取的项目资料"
      }
    ]
  },
  "P12-A": {
    "assetId": "P12-A",
    "variableBindings": [
      {
        "variable": "title",
        "label": "作品标题",
        "sourceKeys": [
          "existingVolumeOutlines",
          "storyArcs",
          "chapterOutline",
          "detailedOutline"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "text",
        "label": "当前文本",
        "sourceKeys": [
          "chapterContent"
        ],
        "manual": true,
        "required": true,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "previous",
        "label": "上一阶段",
        "sourceKeys": [
          "chapterContinuityHandoff",
          "previousPlanReconciliation",
          "recentChapterSummaries",
          "currentFacts",
          "stateCards",
          "heldItems",
          "itemLedger",
          "storyTimeline",
          "foreshadows"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      }
    ]
  },
  "P12-B": {
    "assetId": "P12-B",
    "variableBindings": [
      {
        "variable": "before",
        "label": "之前",
        "sourceKeys": [
          "chapterContent"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "text",
        "label": "当前文本",
        "sourceKeys": [
          "chapterContent"
        ],
        "manual": true,
        "required": true,
        "placeholder": "可补充或修正自动读取的项目资料"
      }
    ]
  },
  "P12-C": {
    "assetId": "P12-C",
    "variableBindings": [
      {
        "variable": "timeline",
        "label": "时间线",
        "sourceKeys": [
          "chapterContinuityHandoff",
          "previousPlanReconciliation",
          "recentChapterSummaries",
          "currentFacts",
          "stateCards",
          "heldItems",
          "itemLedger",
          "storyTimeline",
          "foreshadows"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "items",
        "label": "物品",
        "sourceKeys": [
          "chapterContinuityHandoff",
          "previousPlanReconciliation",
          "recentChapterSummaries",
          "currentFacts",
          "stateCards",
          "heldItems",
          "itemLedger",
          "storyTimeline",
          "foreshadows"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "text",
        "label": "当前文本",
        "sourceKeys": [
          "chapterContent"
        ],
        "manual": true,
        "required": true,
        "placeholder": "可补充或修正自动读取的项目资料"
      }
    ]
  },
  "P12-D": {
    "assetId": "P12-D",
    "variableBindings": [
      {
        "variable": "ledger",
        "label": "账本",
        "sourceKeys": [
          "chapterContinuityHandoff",
          "previousPlanReconciliation",
          "recentChapterSummaries",
          "currentFacts",
          "stateCards",
          "heldItems",
          "itemLedger",
          "storyTimeline",
          "foreshadows"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "text",
        "label": "当前文本",
        "sourceKeys": [
          "chapterContent"
        ],
        "manual": true,
        "required": true,
        "placeholder": "可补充或修正自动读取的项目资料"
      }
    ]
  },
  "P12-E": {
    "assetId": "P12-E",
    "variableBindings": [
      {
        "variable": "plan",
        "label": "当前计划",
        "sourceKeys": [
          "existingVolumeOutlines",
          "storyArcs",
          "chapterOutline",
          "detailedOutline"
        ],
        "manual": true,
        "required": true,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "text",
        "label": "当前文本",
        "sourceKeys": [
          "chapterContent"
        ],
        "manual": true,
        "required": true,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "next",
        "label": "下一步计划",
        "manual": true,
        "required": false,
        "placeholder": "请输入本任务需要的材料"
      }
    ]
  },
  "P12-F": {
    "assetId": "P12-F",
    "variableBindings": [
      {
        "variable": "draft",
        "label": "待修订文本",
        "sourceKeys": [
          "chapterContent"
        ],
        "manual": true,
        "required": true,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "context",
        "label": "相关上下文",
        "sourceKeys": [
          "chapterContent",
          "existingVolumeOutlines",
          "storyArcs",
          "chapterOutline",
          "detailedOutline",
          "chapterContinuityHandoff",
          "previousPlanReconciliation",
          "recentChapterSummaries",
          "currentFacts",
          "stateCards",
          "heldItems",
          "itemLedger",
          "storyTimeline",
          "foreshadows",
          "characters",
          "characterRelations",
          "stateCards",
          "creativeRules",
          "userStyleProfile"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      }
    ]
  },
  "P13-A": {
    "assetId": "P13-A",
    "variableBindings": [
      {
        "variable": "brief",
        "label": "创作简报",
        "sourceKeys": [
          "storyCore"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "promise",
        "label": "读者承诺",
        "sourceKeys": [
          "storyCore"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "outline",
        "label": "大纲",
        "sourceKeys": [
          "existingVolumeOutlines",
          "storyArcs",
          "chapterOutline",
          "detailedOutline"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "manuscript",
        "label": "全稿",
        "sourceKeys": [
          "chapterContent"
        ],
        "manual": true,
        "required": true,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "questions",
        "label": "问题链",
        "sourceKeys": [
          "storyCore"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      }
    ]
  },
  "P13-B": {
    "assetId": "P13-B",
    "variableBindings": [
      {
        "variable": "plot",
        "label": "剧情",
        "sourceKeys": [
          "existingVolumeOutlines",
          "storyArcs",
          "chapterOutline",
          "detailedOutline"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "facts",
        "label": "已确认事实",
        "sourceKeys": [
          "chapterContinuityHandoff",
          "previousPlanReconciliation",
          "recentChapterSummaries",
          "currentFacts",
          "stateCards",
          "heldItems",
          "itemLedger",
          "storyTimeline",
          "foreshadows"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      }
    ]
  },
  "P13-C": {
    "assetId": "P13-C",
    "variableBindings": [
      {
        "variable": "planned",
        "label": "原计划",
        "sourceKeys": [
          "existingVolumeOutlines",
          "storyArcs",
          "chapterOutline",
          "detailedOutline"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "actual",
        "label": "实际进展",
        "sourceKeys": [
          "chapterContinuityHandoff",
          "previousPlanReconciliation",
          "recentChapterSummaries",
          "currentFacts",
          "stateCards",
          "heldItems",
          "itemLedger",
          "storyTimeline",
          "foreshadows"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "plot",
        "label": "剧情",
        "sourceKeys": [
          "existingVolumeOutlines",
          "storyArcs",
          "chapterOutline",
          "detailedOutline"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      }
    ]
  },
  "P13-D": {
    "assetId": "P13-D",
    "variableBindings": [
      {
        "variable": "diagnosis",
        "label": "诊断结果",
        "manual": true,
        "required": false,
        "placeholder": "请输入本任务需要的材料"
      },
      {
        "variable": "map",
        "label": "关系或信息图",
        "manual": true,
        "required": false,
        "placeholder": "请输入本任务需要的材料"
      },
      {
        "variable": "decisions",
        "label": "已确认决策",
        "manual": true,
        "required": false,
        "placeholder": "请输入本任务需要的材料"
      }
    ]
  },
  "P13-E": {
    "assetId": "P13-E",
    "variableBindings": [
      {
        "variable": "opening",
        "label": "开场",
        "sourceKeys": [
          "existingVolumeOutlines",
          "storyArcs",
          "chapterOutline",
          "detailedOutline"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "ending",
        "label": "结局",
        "sourceKeys": [
          "existingVolumeOutlines",
          "storyArcs",
          "chapterOutline",
          "detailedOutline"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "arcs",
        "label": "人物弧",
        "sourceKeys": [
          "existingVolumeOutlines",
          "storyArcs",
          "chapterOutline",
          "detailedOutline"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      }
    ]
  },
  "P14-A": {
    "assetId": "P14-A",
    "variableBindings": [
      {
        "variable": "scene",
        "label": "场景",
        "sourceKeys": [
          "existingVolumeOutlines",
          "storyArcs",
          "chapterOutline",
          "detailedOutline"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "context",
        "label": "相关上下文",
        "sourceKeys": [
          "chapterContent",
          "existingVolumeOutlines",
          "storyArcs",
          "chapterOutline",
          "detailedOutline",
          "chapterContinuityHandoff",
          "previousPlanReconciliation",
          "recentChapterSummaries",
          "currentFacts",
          "stateCards",
          "heldItems",
          "itemLedger",
          "storyTimeline",
          "foreshadows",
          "characters",
          "characterRelations",
          "stateCards",
          "creativeRules",
          "userStyleProfile"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "goal",
        "label": "本次目标",
        "manual": true,
        "required": true,
        "placeholder": "请输入本任务需要的材料"
      },
      {
        "variable": "allowed",
        "label": "允许内容",
        "sourceKeys": [
          "creativeRules",
          "userStyleProfile"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      }
    ]
  },
  "P14-B": {
    "assetId": "P14-B",
    "variableBindings": [
      {
        "variable": "scene",
        "label": "场景",
        "sourceKeys": [
          "existingVolumeOutlines",
          "storyArcs",
          "chapterOutline",
          "detailedOutline"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "characters",
        "label": "角色资料",
        "sourceKeys": [
          "characters",
          "characterRelations",
          "stateCards"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "relationship",
        "label": "人物关系",
        "sourceKeys": [
          "characters",
          "characterRelations",
          "stateCards"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      }
    ]
  },
  "P14-C": {
    "assetId": "P14-C",
    "variableBindings": [
      {
        "variable": "rule",
        "label": "规则",
        "sourceKeys": [
          "creativeRules",
          "userStyleProfile"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "context",
        "label": "相关上下文",
        "sourceKeys": [
          "chapterContent",
          "existingVolumeOutlines",
          "storyArcs",
          "chapterOutline",
          "detailedOutline",
          "chapterContinuityHandoff",
          "previousPlanReconciliation",
          "recentChapterSummaries",
          "currentFacts",
          "stateCards",
          "heldItems",
          "itemLedger",
          "storyTimeline",
          "foreshadows",
          "characters",
          "characterRelations",
          "stateCards",
          "creativeRules",
          "userStyleProfile"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "text",
        "label": "当前文本",
        "sourceKeys": [
          "chapterContent"
        ],
        "manual": true,
        "required": true,
        "placeholder": "可补充或修正自动读取的项目资料"
      }
    ]
  },
  "P14-D": {
    "assetId": "P14-D",
    "variableBindings": [
      {
        "variable": "goal",
        "label": "本次目标",
        "manual": true,
        "required": true,
        "placeholder": "请输入本任务需要的材料"
      },
      {
        "variable": "text",
        "label": "当前文本",
        "sourceKeys": [
          "chapterContent"
        ],
        "manual": true,
        "required": true,
        "placeholder": "可补充或修正自动读取的项目资料"
      }
    ]
  },
  "P14-E": {
    "assetId": "P14-E",
    "variableBindings": [
      {
        "variable": "text",
        "label": "当前文本",
        "sourceKeys": [
          "chapterContent"
        ],
        "manual": true,
        "required": true,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "importance",
        "label": "重要性",
        "manual": true,
        "required": false,
        "placeholder": "请输入本任务需要的材料"
      },
      {
        "variable": "needs",
        "label": "核心需要",
        "manual": true,
        "required": false,
        "placeholder": "请输入本任务需要的材料"
      }
    ]
  },
  "P14-F": {
    "assetId": "P14-F",
    "variableBindings": [
      {
        "variable": "target",
        "label": "目标成品",
        "manual": true,
        "required": false,
        "placeholder": "请输入本任务需要的材料"
      },
      {
        "variable": "style",
        "label": "文风规则",
        "sourceKeys": [
          "creativeRules",
          "userStyleProfile"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "text",
        "label": "当前文本",
        "sourceKeys": [
          "chapterContent"
        ],
        "manual": true,
        "required": true,
        "placeholder": "可补充或修正自动读取的项目资料"
      }
    ]
  },
  "P15-A": {
    "assetId": "P15-A",
    "variableBindings": [
      {
        "variable": "reader",
        "label": "目标读者画像",
        "manual": true,
        "required": false,
        "placeholder": "请输入本任务需要的材料"
      },
      {
        "variable": "chapter",
        "label": "章节",
        "sourceKeys": [
          "chapterContent"
        ],
        "manual": true,
        "required": true,
        "placeholder": "可补充或修正自动读取的项目资料"
      }
    ]
  },
  "P15-B": {
    "assetId": "P15-B",
    "variableBindings": [
      {
        "variable": "contract",
        "label": "作品承诺",
        "manual": true,
        "required": false,
        "placeholder": "请输入本任务需要的材料"
      },
      {
        "variable": "text",
        "label": "当前文本",
        "sourceKeys": [
          "chapterContent"
        ],
        "manual": true,
        "required": true,
        "placeholder": "可补充或修正自动读取的项目资料"
      }
    ]
  },
  "P15-C": {
    "assetId": "P15-C",
    "variableBindings": [
      {
        "variable": "profiles",
        "label": "人物档案",
        "manual": true,
        "required": false,
        "placeholder": "请输入本任务需要的材料"
      },
      {
        "variable": "questions",
        "label": "问题链",
        "sourceKeys": [
          "storyCore"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "text",
        "label": "当前文本",
        "sourceKeys": [
          "chapterContent"
        ],
        "manual": true,
        "required": true,
        "placeholder": "可补充或修正自动读取的项目资料"
      }
    ]
  },
  "P15-D": {
    "assetId": "P15-D",
    "variableBindings": [
      {
        "variable": "text",
        "label": "当前文本",
        "sourceKeys": [
          "chapterContent"
        ],
        "manual": true,
        "required": true,
        "placeholder": "可补充或修正自动读取的项目资料"
      }
    ]
  },
  "P15-E": {
    "assetId": "P15-E",
    "variableBindings": [
      {
        "variable": "goal",
        "label": "本次目标",
        "manual": true,
        "required": true,
        "placeholder": "请输入本任务需要的材料"
      },
      {
        "variable": "a",
        "label": "方案 A",
        "manual": true,
        "required": true,
        "placeholder": "请输入本任务需要的材料"
      },
      {
        "variable": "b",
        "label": "方案 B",
        "manual": true,
        "required": true,
        "placeholder": "请输入本任务需要的材料"
      }
    ]
  },
  "P16-A": {
    "assetId": "P16-A",
    "variableBindings": [
      {
        "variable": "core",
        "label": "故事核心",
        "sourceKeys": [
          "storyCore"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "genre",
        "label": "题材",
        "projectField": "genres",
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "tone",
        "label": "情绪与语气",
        "manual": true,
        "required": false,
        "placeholder": "请输入本任务需要的材料"
      },
      {
        "variable": "avoid",
        "label": "禁写项",
        "sourceKeys": [
          "creativeRules",
          "userStyleProfile"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      }
    ]
  },
  "P16-B": {
    "assetId": "P16-B",
    "variableBindings": [
      {
        "variable": "core",
        "label": "故事核心",
        "sourceKeys": [
          "storyCore"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "opening",
        "label": "开场",
        "sourceKeys": [
          "existingVolumeOutlines",
          "storyArcs",
          "chapterOutline",
          "detailedOutline"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "promise",
        "label": "读者承诺",
        "sourceKeys": [
          "storyCore"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "boundary",
        "label": "边界",
        "sourceKeys": [
          "creativeRules",
          "userStyleProfile"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "limit",
        "label": "限制条件",
        "manual": true,
        "required": false,
        "placeholder": "请输入本任务需要的材料"
      }
    ]
  },
  "P16-C": {
    "assetId": "P16-C",
    "variableBindings": [
      {
        "variable": "story",
        "label": "故事",
        "sourceKeys": [
          "storyCore"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "length",
        "label": "篇幅要求",
        "manual": true,
        "required": false,
        "placeholder": "请输入本任务需要的材料"
      },
      {
        "variable": "requirements",
        "label": "任务要求",
        "manual": true,
        "required": false,
        "placeholder": "请输入本任务需要的材料"
      }
    ]
  },
  "P16-D": {
    "assetId": "P16-D",
    "variableBindings": [
      {
        "variable": "facts",
        "label": "已确认事实",
        "sourceKeys": [
          "chapterContinuityHandoff",
          "previousPlanReconciliation",
          "recentChapterSummaries",
          "currentFacts",
          "stateCards",
          "heldItems",
          "itemLedger",
          "storyTimeline",
          "foreshadows"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "genre",
        "label": "题材",
        "projectField": "genres",
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "schema",
        "label": "输出结构",
        "manual": true,
        "required": false,
        "placeholder": "请输入本任务需要的材料"
      }
    ]
  },
  "P16-E": {
    "assetId": "P16-E",
    "variableBindings": [
      {
        "variable": "work",
        "label": "作品材料",
        "manual": true,
        "required": true,
        "placeholder": "请输入本任务需要的材料"
      },
      {
        "variable": "author",
        "label": "作者目标",
        "manual": true,
        "required": false,
        "placeholder": "请输入本任务需要的材料"
      },
      {
        "variable": "requirements",
        "label": "任务要求",
        "manual": true,
        "required": false,
        "placeholder": "请输入本任务需要的材料"
      },
      {
        "variable": "comps",
        "label": "比较对象",
        "manual": true,
        "required": false,
        "placeholder": "请输入本任务需要的材料"
      }
    ]
  },
  "P17-A": {
    "assetId": "P17-A",
    "variableBindings": [
      {
        "variable": "metadata",
        "label": "资产元数据",
        "manual": true,
        "required": false,
        "placeholder": "请输入本任务需要的材料"
      },
      {
        "variable": "input",
        "label": "输入材料",
        "manual": true,
        "required": true,
        "placeholder": "请输入本任务需要的材料"
      },
      {
        "variable": "output",
        "label": "输出样例",
        "manual": true,
        "required": false,
        "placeholder": "请输入本任务需要的材料"
      },
      {
        "variable": "accepted",
        "label": "已采纳内容",
        "manual": true,
        "required": false,
        "placeholder": "请输入本任务需要的材料"
      },
      {
        "variable": "feedback",
        "label": "读者反馈",
        "manual": true,
        "required": false,
        "placeholder": "请输入本任务需要的材料"
      }
    ]
  },
  "P17-B": {
    "assetId": "P17-B",
    "variableBindings": [
      {
        "variable": "a",
        "label": "方案 A",
        "manual": true,
        "required": true,
        "placeholder": "请输入本任务需要的材料"
      },
      {
        "variable": "b",
        "label": "方案 B",
        "manual": true,
        "required": true,
        "placeholder": "请输入本任务需要的材料"
      },
      {
        "variable": "contract",
        "label": "作品承诺",
        "manual": true,
        "required": false,
        "placeholder": "请输入本任务需要的材料"
      },
      {
        "variable": "failures",
        "label": "失败样例",
        "manual": true,
        "required": false,
        "placeholder": "请输入本任务需要的材料"
      }
    ]
  },
  "P17-C": {
    "assetId": "P17-C",
    "variableBindings": [
      {
        "variable": "stage",
        "label": "当前阶段",
        "manual": true,
        "required": false,
        "placeholder": "请输入本任务需要的材料"
      },
      {
        "variable": "task_type",
        "label": "任务类型",
        "manual": true,
        "required": false,
        "placeholder": "请输入本任务需要的材料"
      },
      {
        "variable": "required",
        "label": "硬性要求",
        "manual": true,
        "required": false,
        "placeholder": "请输入本任务需要的材料"
      },
      {
        "variable": "optional",
        "label": "可选内容",
        "manual": true,
        "required": false,
        "placeholder": "请输入本任务需要的材料"
      },
      {
        "variable": "target",
        "label": "目标成品",
        "manual": true,
        "required": false,
        "placeholder": "请输入本任务需要的材料"
      },
      {
        "variable": "profiles",
        "label": "人物档案",
        "manual": true,
        "required": false,
        "placeholder": "请输入本任务需要的材料"
      },
      {
        "variable": "risks",
        "label": "已知风险",
        "manual": true,
        "required": false,
        "placeholder": "请输入本任务需要的材料"
      }
    ]
  },
  "P17-D": {
    "assetId": "P17-D",
    "variableBindings": [
      {
        "variable": "assets",
        "label": "Prompt 资产集",
        "manual": true,
        "required": true,
        "placeholder": "请输入本任务需要的材料"
      }
    ]
  },
  "P17-E": {
    "assetId": "P17-E",
    "variableBindings": [
      {
        "variable": "asset",
        "label": "Prompt 资产",
        "manual": true,
        "required": true,
        "placeholder": "请输入本任务需要的材料"
      },
      {
        "variable": "tests",
        "label": "测试样例",
        "manual": true,
        "required": false,
        "placeholder": "请输入本任务需要的材料"
      },
      {
        "variable": "provenance",
        "label": "来源记录",
        "manual": true,
        "required": false,
        "placeholder": "请输入本任务需要的材料"
      }
    ]
  },
  "G-MYSTERY-A": {
    "assetId": "G-MYSTERY-A",
    "variableBindings": [
      {
        "variable": "concept",
        "label": "故事概念",
        "sourceKeys": [
          "storyCore"
        ],
        "manual": true,
        "required": true,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "world",
        "label": "世界观与规则",
        "sourceKeys": [
          "worldview",
          "worldRules",
          "powerSystem",
          "codex",
          "historical",
          "locations"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "characters",
        "label": "角色资料",
        "sourceKeys": [
          "characters",
          "characterRelations",
          "stateCards"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      }
    ],
    "applicability": {
      "genres": [
        "zhentan",
        "xuanyi"
      ]
    }
  },
  "G-MYSTERY-B": {
    "assetId": "G-MYSTERY-B",
    "variableBindings": [
      {
        "variable": "truth",
        "label": "已确认真相",
        "sourceKeys": [
          "existingVolumeOutlines",
          "storyArcs",
          "chapterOutline",
          "detailedOutline"
        ],
        "manual": true,
        "required": true,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "outline",
        "label": "大纲",
        "sourceKeys": [
          "existingVolumeOutlines",
          "storyArcs",
          "chapterOutline",
          "detailedOutline"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "pov",
        "label": "视角",
        "sourceKeys": [
          "characters",
          "characterRelations",
          "stateCards"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      }
    ],
    "applicability": {
      "genres": [
        "zhentan",
        "xuanyi"
      ]
    }
  },
  "G-MYSTERY-C": {
    "assetId": "G-MYSTERY-C",
    "variableBindings": [
      {
        "variable": "truth",
        "label": "已确认真相",
        "sourceKeys": [
          "existingVolumeOutlines",
          "storyArcs",
          "chapterOutline",
          "detailedOutline"
        ],
        "manual": true,
        "required": true,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "suspects",
        "label": "嫌疑人",
        "sourceKeys": [
          "characters",
          "characterRelations",
          "stateCards"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "clues",
        "label": "线索",
        "sourceKeys": [
          "existingVolumeOutlines",
          "storyArcs",
          "chapterOutline",
          "detailedOutline"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      }
    ],
    "applicability": {
      "genres": [
        "zhentan",
        "xuanyi"
      ]
    }
  },
  "G-MYSTERY-D": {
    "assetId": "G-MYSTERY-D",
    "variableBindings": [
      {
        "variable": "material",
        "label": "输入材料",
        "sourceKeys": [
          "storyCore",
          "characters",
          "characterRelations",
          "stateCards",
          "existingVolumeOutlines",
          "storyArcs",
          "chapterOutline",
          "detailedOutline"
        ],
        "manual": true,
        "required": true,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "investigator",
        "label": "调查者",
        "sourceKeys": [
          "characters",
          "characterRelations",
          "stateCards"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      }
    ],
    "applicability": {
      "genres": [
        "zhentan",
        "xuanyi"
      ]
    }
  },
  "G-MYSTERY-E": {
    "assetId": "G-MYSTERY-E",
    "variableBindings": [
      {
        "variable": "text",
        "label": "当前文本",
        "sourceKeys": [
          "chapterContent"
        ],
        "manual": true,
        "required": true,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "truth",
        "label": "已确认真相",
        "sourceKeys": [
          "existingVolumeOutlines",
          "storyArcs",
          "chapterOutline",
          "detailedOutline"
        ],
        "manual": true,
        "required": true,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "clues",
        "label": "线索",
        "sourceKeys": [
          "existingVolumeOutlines",
          "storyArcs",
          "chapterOutline",
          "detailedOutline"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      }
    ],
    "applicability": {
      "genres": [
        "zhentan",
        "xuanyi"
      ]
    }
  },
  "G-HISTORY-A": {
    "assetId": "G-HISTORY-A",
    "variableBindings": [
      {
        "variable": "time_place",
        "label": "时间与地点",
        "sourceKeys": [
          "locations",
          "worldview"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "material",
        "label": "输入材料",
        "sourceKeys": [
          "storyCore",
          "worldview",
          "worldRules",
          "powerSystem",
          "codex",
          "historical",
          "locations"
        ],
        "manual": true,
        "required": true,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "plan",
        "label": "当前计划",
        "sourceKeys": [
          "existingVolumeOutlines",
          "storyArcs",
          "chapterOutline",
          "detailedOutline"
        ],
        "manual": true,
        "required": true,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "mode",
        "label": "创作模式",
        "manual": true,
        "required": false,
        "placeholder": "请输入本任务需要的材料"
      }
    ],
    "applicability": {
      "genres": [
        "lishi",
        "jiakong",
        "zhuanji",
        "songmingqing",
        "qinhan"
      ]
    }
  },
  "G-HISTORY-B": {
    "assetId": "G-HISTORY-B",
    "variableBindings": [
      {
        "variable": "context",
        "label": "相关上下文",
        "sourceKeys": [
          "storyCore",
          "worldview",
          "worldRules",
          "powerSystem",
          "codex",
          "historical",
          "locations"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "identity",
        "label": "身份",
        "sourceKeys": [
          "characters",
          "characterRelations",
          "stateCards"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "scene",
        "label": "场景",
        "sourceKeys": [
          "existingVolumeOutlines",
          "storyArcs",
          "chapterOutline",
          "detailedOutline"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      }
    ],
    "applicability": {
      "genres": [
        "lishi",
        "jiakong",
        "zhuanji",
        "songmingqing",
        "qinhan"
      ]
    }
  },
  "G-HISTORY-C": {
    "assetId": "G-HISTORY-C",
    "variableBindings": [
      {
        "variable": "facts",
        "label": "已确认事实",
        "sourceKeys": [
          "chapterContinuityHandoff",
          "previousPlanReconciliation",
          "recentChapterSummaries",
          "currentFacts",
          "stateCards",
          "heldItems",
          "itemLedger",
          "storyTimeline",
          "foreshadows"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "fictional",
        "label": "虚构内容",
        "manual": true,
        "required": false,
        "placeholder": "请输入本任务需要的材料"
      },
      {
        "variable": "interaction",
        "label": "关键互动",
        "manual": true,
        "required": false,
        "placeholder": "请输入本任务需要的材料"
      }
    ],
    "applicability": {
      "genres": [
        "lishi",
        "jiakong",
        "zhuanji",
        "songmingqing",
        "qinhan"
      ]
    }
  },
  "G-HISTORY-D": {
    "assetId": "G-HISTORY-D",
    "variableBindings": [
      {
        "variable": "text",
        "label": "当前文本",
        "sourceKeys": [
          "chapterContent"
        ],
        "manual": true,
        "required": true,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "rules",
        "label": "规则",
        "sourceKeys": [
          "creativeRules",
          "userStyleProfile"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      }
    ],
    "applicability": {
      "genres": [
        "lishi",
        "jiakong",
        "zhuanji",
        "songmingqing",
        "qinhan"
      ]
    }
  },
  "G-COMEDY-A": {
    "assetId": "G-COMEDY-A",
    "variableBindings": [
      {
        "variable": "characters",
        "label": "角色资料",
        "sourceKeys": [
          "characters",
          "characterRelations",
          "stateCards"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "situation",
        "label": "当前处境",
        "manual": true,
        "required": false,
        "placeholder": "请输入本任务需要的材料"
      },
      {
        "variable": "tone",
        "label": "情绪与语气",
        "manual": true,
        "required": false,
        "placeholder": "请输入本任务需要的材料"
      }
    ],
    "applicability": {
      "genres": [
        "qingxiaoshuo",
        "yule"
      ]
    }
  },
  "G-COMEDY-B": {
    "assetId": "G-COMEDY-B",
    "variableBindings": [
      {
        "variable": "material",
        "label": "输入材料",
        "sourceKeys": [
          "storyCore",
          "characters",
          "characterRelations",
          "stateCards",
          "existingVolumeOutlines",
          "storyArcs",
          "chapterOutline",
          "detailedOutline"
        ],
        "manual": true,
        "required": true,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "knowledge",
        "label": "人物信息边界",
        "sourceKeys": [
          "characters",
          "characterRelations",
          "currentFacts"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      }
    ],
    "applicability": {
      "genres": [
        "qingxiaoshuo",
        "yule"
      ]
    }
  },
  "G-COMEDY-C": {
    "assetId": "G-COMEDY-C",
    "variableBindings": [
      {
        "variable": "text",
        "label": "当前文本",
        "sourceKeys": [
          "chapterContent"
        ],
        "manual": true,
        "required": true,
        "placeholder": "可补充或修正自动读取的项目资料"
      }
    ],
    "applicability": {
      "genres": [
        "qingxiaoshuo",
        "yule"
      ]
    }
  },
  "G-COMEDY-D": {
    "assetId": "G-COMEDY-D",
    "variableBindings": [
      {
        "variable": "text",
        "label": "当前文本",
        "sourceKeys": [
          "chapterContent"
        ],
        "manual": true,
        "required": true,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "tone",
        "label": "情绪与语气",
        "manual": true,
        "required": false,
        "placeholder": "请输入本任务需要的材料"
      }
    ],
    "applicability": {
      "genres": [
        "qingxiaoshuo",
        "yule"
      ]
    }
  },
  "G-FANTASY-A": {
    "assetId": "G-FANTASY-A",
    "variableBindings": [
      {
        "variable": "concept",
        "label": "故事概念",
        "sourceKeys": [
          "storyCore"
        ],
        "manual": true,
        "required": true,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "story",
        "label": "故事",
        "sourceKeys": [
          "storyCore"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "rules",
        "label": "规则",
        "sourceKeys": [
          "creativeRules",
          "userStyleProfile"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      }
    ],
    "applicability": {
      "genres": [
        "qihuan",
        "xifang",
        "shishi",
        "heian",
        "xuanhuan",
        "xianxia"
      ]
    }
  },
  "G-FANTASY-B": {
    "assetId": "G-FANTASY-B",
    "variableBindings": [
      {
        "variable": "cosmology",
        "label": "宇宙观",
        "sourceKeys": [
          "worldview",
          "worldRules",
          "powerSystem",
          "codex",
          "historical",
          "locations"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "factions",
        "label": "势力",
        "sourceKeys": [
          "worldview",
          "worldRules",
          "powerSystem",
          "codex",
          "historical",
          "locations"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      }
    ],
    "applicability": {
      "genres": [
        "qihuan",
        "xifang",
        "shishi",
        "heian",
        "xuanhuan",
        "xianxia"
      ]
    }
  },
  "G-FANTASY-C": {
    "assetId": "G-FANTASY-C",
    "variableBindings": [
      {
        "variable": "rules",
        "label": "规则",
        "sourceKeys": [
          "creativeRules",
          "userStyleProfile"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "goal",
        "label": "本次目标",
        "manual": true,
        "required": true,
        "placeholder": "请输入本任务需要的材料"
      },
      {
        "variable": "pov",
        "label": "视角",
        "sourceKeys": [
          "characters",
          "characterRelations",
          "stateCards"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      }
    ],
    "applicability": {
      "genres": [
        "qihuan",
        "xifang",
        "shishi",
        "heian",
        "xuanhuan",
        "xianxia"
      ]
    }
  },
  "G-FANTASY-D": {
    "assetId": "G-FANTASY-D",
    "variableBindings": [
      {
        "variable": "rules",
        "label": "规则",
        "sourceKeys": [
          "creativeRules",
          "userStyleProfile"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "plot",
        "label": "剧情",
        "sourceKeys": [
          "existingVolumeOutlines",
          "storyArcs",
          "chapterOutline",
          "detailedOutline"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      }
    ],
    "applicability": {
      "genres": [
        "qihuan",
        "xifang",
        "shishi",
        "heian",
        "xuanhuan",
        "xianxia"
      ]
    }
  },
  "G-HORROR-A": {
    "assetId": "G-HORROR-A",
    "variableBindings": [
      {
        "variable": "concept",
        "label": "故事概念",
        "sourceKeys": [
          "storyCore"
        ],
        "manual": true,
        "required": true,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "characters",
        "label": "角色资料",
        "sourceKeys": [
          "characters",
          "characterRelations",
          "stateCards"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "boundaries",
        "label": "边界条件",
        "manual": true,
        "required": false,
        "placeholder": "请输入本任务需要的材料"
      }
    ],
    "applicability": {
      "genres": [
        "kongbu",
        "xuanyi"
      ]
    }
  },
  "G-HORROR-B": {
    "assetId": "G-HORROR-B",
    "variableBindings": [
      {
        "variable": "rules",
        "label": "规则",
        "sourceKeys": [
          "creativeRules",
          "userStyleProfile"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "outline",
        "label": "大纲",
        "sourceKeys": [
          "existingVolumeOutlines",
          "storyArcs",
          "chapterOutline",
          "detailedOutline"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      }
    ],
    "applicability": {
      "genres": [
        "kongbu",
        "xuanyi"
      ]
    }
  },
  "G-HORROR-C": {
    "assetId": "G-HORROR-C",
    "variableBindings": [
      {
        "variable": "goal",
        "label": "本次目标",
        "manual": true,
        "required": true,
        "placeholder": "请输入本任务需要的材料"
      },
      {
        "variable": "space",
        "label": "空间布局",
        "sourceKeys": [
          "locations",
          "worldview"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "threat",
        "label": "恐怖威胁",
        "manual": true,
        "required": true,
        "placeholder": "请输入本任务需要的材料"
      },
      {
        "variable": "pov",
        "label": "视角",
        "sourceKeys": [
          "characters",
          "characterRelations",
          "stateCards"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      }
    ],
    "applicability": {
      "genres": [
        "kongbu",
        "xuanyi"
      ]
    }
  },
  "G-HORROR-D": {
    "assetId": "G-HORROR-D",
    "variableBindings": [
      {
        "variable": "questions",
        "label": "问题链",
        "sourceKeys": [
          "storyCore"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "rules",
        "label": "规则",
        "sourceKeys": [
          "creativeRules",
          "userStyleProfile"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "ending",
        "label": "结局",
        "sourceKeys": [
          "existingVolumeOutlines",
          "storyArcs",
          "chapterOutline",
          "detailedOutline"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      }
    ],
    "applicability": {
      "genres": [
        "kongbu",
        "xuanyi"
      ]
    }
  },
  "G-PROGRESSION-A": {
    "assetId": "G-PROGRESSION-A",
    "variableBindings": [
      {
        "variable": "promise",
        "label": "读者承诺",
        "sourceKeys": [
          "storyCore"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "world",
        "label": "世界观与规则",
        "sourceKeys": [
          "worldview",
          "worldRules",
          "powerSystem",
          "codex",
          "historical",
          "locations"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "protagonist",
        "label": "主角资料",
        "sourceKeys": [
          "characters",
          "characterRelations",
          "stateCards"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      }
    ],
    "applicability": {
      "genres": [
        "xuanhuan",
        "dongfang",
        "gaowu",
        "xianxia",
        "xiuzhen",
        "youxi",
        "youxiyijie"
      ]
    }
  },
  "G-PROGRESSION-B": {
    "assetId": "G-PROGRESSION-B",
    "variableBindings": [
      {
        "variable": "system",
        "label": "规则系统",
        "manual": true,
        "required": false,
        "placeholder": "请输入本任务需要的材料"
      },
      {
        "variable": "economy",
        "label": "经济系统",
        "sourceKeys": [
          "worldview",
          "worldRules",
          "powerSystem",
          "codex",
          "historical",
          "locations"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      }
    ],
    "applicability": {
      "genres": [
        "xuanhuan",
        "dongfang",
        "gaowu",
        "xianxia",
        "xiuzhen",
        "youxi",
        "youxiyijie"
      ]
    }
  },
  "G-PROGRESSION-C": {
    "assetId": "G-PROGRESSION-C",
    "variableBindings": [
      {
        "variable": "capabilities",
        "label": "可用能力",
        "sourceKeys": [
          "characters",
          "characterRelations",
          "stateCards"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "goal",
        "label": "本次目标",
        "manual": true,
        "required": true,
        "placeholder": "请输入本任务需要的材料"
      },
      {
        "variable": "stage",
        "label": "当前阶段",
        "manual": true,
        "required": false,
        "placeholder": "请输入本任务需要的材料"
      }
    ],
    "applicability": {
      "genres": [
        "xuanhuan",
        "dongfang",
        "gaowu",
        "xianxia",
        "xiuzhen",
        "youxi",
        "youxiyijie"
      ]
    }
  },
  "G-PROGRESSION-D": {
    "assetId": "G-PROGRESSION-D",
    "variableBindings": [
      {
        "variable": "growth",
        "label": "成长进度",
        "manual": true,
        "required": false,
        "placeholder": "请输入本任务需要的材料"
      },
      {
        "variable": "range",
        "label": "叙事范围",
        "manual": true,
        "required": false,
        "placeholder": "请输入本任务需要的材料"
      },
      {
        "variable": "serial",
        "label": "连载模式",
        "projectField": "serializationMode",
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      }
    ],
    "applicability": {
      "genres": [
        "xuanhuan",
        "dongfang",
        "gaowu",
        "xianxia",
        "xiuzhen",
        "youxi",
        "youxiyijie"
      ]
    }
  },
  "G-PROGRESSION-E": {
    "assetId": "G-PROGRESSION-E",
    "variableBindings": [
      {
        "variable": "history",
        "label": "历史",
        "sourceKeys": [
          "worldview",
          "worldRules",
          "powerSystem",
          "codex",
          "historical",
          "locations"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "future",
        "label": "后续计划",
        "manual": true,
        "required": false,
        "placeholder": "请输入本任务需要的材料"
      }
    ],
    "applicability": {
      "genres": [
        "xuanhuan",
        "dongfang",
        "gaowu",
        "xianxia",
        "xiuzhen",
        "youxi",
        "youxiyijie"
      ]
    }
  },
  "G-ROMANCE-A": {
    "assetId": "G-ROMANCE-A",
    "variableBindings": [
      {
        "variable": "characters",
        "label": "角色资料",
        "sourceKeys": [
          "characters",
          "characterRelations",
          "stateCards"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "world",
        "label": "世界观与规则",
        "sourceKeys": [
          "worldview",
          "worldRules",
          "powerSystem",
          "codex",
          "historical",
          "locations"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "mode",
        "label": "创作模式",
        "manual": true,
        "required": false,
        "placeholder": "请输入本任务需要的材料"
      }
    ],
    "applicability": {
      "genres": [
        "dushi",
        "dushenghuo",
        "xueyuan",
        "qingxiaoshuo"
      ]
    }
  },
  "G-ROMANCE-B": {
    "assetId": "G-ROMANCE-B",
    "variableBindings": [
      {
        "variable": "engine",
        "label": "叙事发动机",
        "manual": true,
        "required": false,
        "placeholder": "请输入本任务需要的材料"
      },
      {
        "variable": "plot",
        "label": "剧情",
        "sourceKeys": [
          "existingVolumeOutlines",
          "storyArcs",
          "chapterOutline",
          "detailedOutline"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "ending",
        "label": "结局",
        "sourceKeys": [
          "existingVolumeOutlines",
          "storyArcs",
          "chapterOutline",
          "detailedOutline"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      }
    ],
    "applicability": {
      "genres": [
        "dushi",
        "dushenghuo",
        "xueyuan",
        "qingxiaoshuo"
      ]
    }
  },
  "G-ROMANCE-C": {
    "assetId": "G-ROMANCE-C",
    "variableBindings": [
      {
        "variable": "outline",
        "label": "大纲",
        "sourceKeys": [
          "existingVolumeOutlines",
          "storyArcs",
          "chapterOutline",
          "detailedOutline"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "knowledge",
        "label": "人物信息边界",
        "sourceKeys": [
          "characters",
          "characterRelations",
          "currentFacts"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      }
    ],
    "applicability": {
      "genres": [
        "dushi",
        "dushenghuo",
        "xueyuan",
        "qingxiaoshuo"
      ]
    }
  },
  "G-ROMANCE-D": {
    "assetId": "G-ROMANCE-D",
    "variableBindings": [
      {
        "variable": "state",
        "label": "状态",
        "sourceKeys": [
          "chapterContinuityHandoff",
          "previousPlanReconciliation",
          "recentChapterSummaries",
          "currentFacts",
          "stateCards",
          "heldItems",
          "itemLedger",
          "storyTimeline",
          "foreshadows"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "goal",
        "label": "本次目标",
        "manual": true,
        "required": true,
        "placeholder": "请输入本任务需要的材料"
      },
      {
        "variable": "boundary",
        "label": "边界",
        "sourceKeys": [
          "creativeRules",
          "userStyleProfile"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      }
    ],
    "applicability": {
      "genres": [
        "dushi",
        "dushenghuo",
        "xueyuan",
        "qingxiaoshuo"
      ]
    }
  },
  "G-ROMANCE-E": {
    "assetId": "G-ROMANCE-E",
    "variableBindings": [
      {
        "variable": "arc",
        "label": "人物弧",
        "sourceKeys": [
          "existingVolumeOutlines",
          "storyArcs",
          "chapterOutline",
          "detailedOutline"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "ending",
        "label": "结局",
        "sourceKeys": [
          "existingVolumeOutlines",
          "storyArcs",
          "chapterOutline",
          "detailedOutline"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      }
    ],
    "applicability": {
      "genres": [
        "dushi",
        "dushenghuo",
        "xueyuan",
        "qingxiaoshuo"
      ]
    }
  },
  "G-LITERARY-A": {
    "assetId": "G-LITERARY-A",
    "variableBindings": [
      {
        "variable": "context",
        "label": "相关上下文",
        "sourceKeys": [
          "storyCore"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "characters",
        "label": "角色资料",
        "sourceKeys": [
          "characters",
          "characterRelations",
          "stateCards"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "theme",
        "label": "主题张力",
        "sourceKeys": [
          "storyCore"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      }
    ],
    "applicability": {
      "genres": [
        "dushenghuo",
        "zhuanji",
        "other"
      ]
    }
  },
  "G-LITERARY-B": {
    "assetId": "G-LITERARY-B",
    "variableBindings": [
      {
        "variable": "material",
        "label": "输入材料",
        "sourceKeys": [
          "storyCore"
        ],
        "manual": true,
        "required": true,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "length",
        "label": "篇幅要求",
        "manual": true,
        "required": false,
        "placeholder": "请输入本任务需要的材料"
      }
    ],
    "applicability": {
      "genres": [
        "dushenghuo",
        "zhuanji",
        "other"
      ]
    }
  },
  "G-LITERARY-C": {
    "assetId": "G-LITERARY-C",
    "variableBindings": [
      {
        "variable": "text",
        "label": "当前文本",
        "sourceKeys": [
          "chapterContent"
        ],
        "manual": true,
        "required": true,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "context",
        "label": "相关上下文",
        "sourceKeys": [
          "storyCore"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      }
    ],
    "applicability": {
      "genres": [
        "dushenghuo",
        "zhuanji",
        "other"
      ]
    }
  },
  "G-LITERARY-D": {
    "assetId": "G-LITERARY-D",
    "variableBindings": [
      {
        "variable": "arc",
        "label": "人物弧",
        "sourceKeys": [
          "existingVolumeOutlines",
          "storyArcs",
          "chapterOutline",
          "detailedOutline"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "candidates",
        "label": "候选方案",
        "manual": true,
        "required": false,
        "placeholder": "请输入本任务需要的材料"
      }
    ],
    "applicability": {
      "genres": [
        "dushenghuo",
        "zhuanji",
        "other"
      ]
    }
  },
  "G-SCIFI-A": {
    "assetId": "G-SCIFI-A",
    "variableBindings": [
      {
        "variable": "novum",
        "label": "核心新设定",
        "sourceKeys": [
          "worldview",
          "worldRules",
          "powerSystem",
          "codex",
          "historical",
          "locations"
        ],
        "manual": true,
        "required": true,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "science",
        "label": "科学依据",
        "sourceKeys": [
          "worldview",
          "worldRules",
          "powerSystem",
          "codex",
          "historical",
          "locations"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "story",
        "label": "故事",
        "sourceKeys": [
          "storyCore"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      }
    ],
    "applicability": {
      "genres": [
        "kehuan",
        "xingji",
        "weilai",
        "shikong",
        "chaoji",
        "moshi"
      ]
    }
  },
  "G-SCIFI-B": {
    "assetId": "G-SCIFI-B",
    "variableBindings": [
      {
        "variable": "tech",
        "label": "技术",
        "sourceKeys": [
          "worldview",
          "worldRules",
          "powerSystem",
          "codex",
          "historical",
          "locations"
        ],
        "manual": true,
        "required": true,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "timeline",
        "label": "时间线",
        "sourceKeys": [
          "chapterContinuityHandoff",
          "previousPlanReconciliation",
          "recentChapterSummaries",
          "currentFacts",
          "stateCards",
          "heldItems",
          "itemLedger",
          "storyTimeline",
          "foreshadows"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "baseline",
        "label": "当前基线",
        "sourceKeys": [
          "storyCore",
          "worldview",
          "worldRules",
          "powerSystem",
          "codex",
          "historical",
          "locations"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      }
    ],
    "applicability": {
      "genres": [
        "kehuan",
        "xingji",
        "weilai",
        "shikong",
        "chaoji",
        "moshi"
      ]
    }
  },
  "G-SCIFI-C": {
    "assetId": "G-SCIFI-C",
    "variableBindings": [
      {
        "variable": "claims",
        "label": "待核查主张",
        "manual": true,
        "required": false,
        "placeholder": "请输入本任务需要的材料"
      },
      {
        "variable": "rules",
        "label": "规则",
        "sourceKeys": [
          "creativeRules",
          "userStyleProfile"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "text",
        "label": "当前文本",
        "sourceKeys": [
          "chapterContent"
        ],
        "manual": true,
        "required": true,
        "placeholder": "可补充或修正自动读取的项目资料"
      }
    ],
    "applicability": {
      "genres": [
        "kehuan",
        "xingji",
        "weilai",
        "shikong",
        "chaoji",
        "moshi"
      ]
    }
  },
  "G-SCIFI-D": {
    "assetId": "G-SCIFI-D",
    "variableBindings": [
      {
        "variable": "tech",
        "label": "技术",
        "sourceKeys": [
          "worldview",
          "worldRules",
          "powerSystem",
          "codex",
          "historical",
          "locations"
        ],
        "manual": true,
        "required": true,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "characters",
        "label": "角色资料",
        "sourceKeys": [
          "characters",
          "characterRelations",
          "stateCards"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "theme",
        "label": "主题张力",
        "sourceKeys": [
          "storyCore"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      }
    ],
    "applicability": {
      "genres": [
        "kehuan",
        "xingji",
        "weilai",
        "shikong",
        "chaoji",
        "moshi"
      ]
    }
  },
  "G-ENSEMBLE-A": {
    "assetId": "G-ENSEMBLE-A",
    "variableBindings": [
      {
        "variable": "concept",
        "label": "故事概念",
        "sourceKeys": [
          "storyCore"
        ],
        "manual": true,
        "required": true,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "characters",
        "label": "角色资料",
        "sourceKeys": [
          "characters",
          "characterRelations",
          "stateCards"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "length",
        "label": "篇幅要求",
        "manual": true,
        "required": false,
        "placeholder": "请输入本任务需要的材料"
      }
    ]
  },
  "G-ENSEMBLE-B": {
    "assetId": "G-ENSEMBLE-B",
    "variableBindings": [
      {
        "variable": "outline",
        "label": "大纲",
        "sourceKeys": [
          "existingVolumeOutlines",
          "storyArcs",
          "chapterOutline",
          "detailedOutline"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "povs",
        "label": "多视角",
        "sourceKeys": [
          "characters",
          "characterRelations",
          "stateCards"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "information",
        "label": "信息结构",
        "sourceKeys": [
          "characters",
          "characterRelations",
          "currentFacts"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      }
    ]
  },
  "G-ENSEMBLE-C": {
    "assetId": "G-ENSEMBLE-C",
    "variableBindings": [
      {
        "variable": "facts",
        "label": "已确认事实",
        "sourceKeys": [
          "chapterContinuityHandoff",
          "previousPlanReconciliation",
          "recentChapterSummaries",
          "currentFacts",
          "stateCards",
          "heldItems",
          "itemLedger",
          "storyTimeline",
          "foreshadows"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "beliefs",
        "label": "信念",
        "sourceKeys": [
          "characters",
          "characterRelations",
          "stateCards"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      }
    ]
  },
  "G-ENSEMBLE-D": {
    "assetId": "G-ENSEMBLE-D",
    "variableBindings": [
      {
        "variable": "lines",
        "label": "剧情线",
        "sourceKeys": [
          "existingVolumeOutlines",
          "storyArcs",
          "chapterOutline",
          "detailedOutline"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      },
      {
        "variable": "ending",
        "label": "结局",
        "sourceKeys": [
          "existingVolumeOutlines",
          "storyArcs",
          "chapterOutline",
          "detailedOutline"
        ],
        "manual": true,
        "required": false,
        "placeholder": "可补充或修正自动读取的项目资料"
      }
    ]
  }
}

