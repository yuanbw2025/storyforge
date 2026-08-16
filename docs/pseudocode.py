# =====================================================================
# 叙事引擎核心类：5轨正交叙事系统
# =====================================================================

class CharacterMomentumTrack:
    def __init__(self):
        self.desire_strength = 10.0   # 欲望值（动力源）
        self.growth_state = 0.0       # 心智成长值 (0 ~ 100)
        self.base_tension = 9         # 基础张力系数
        self.cooldown = 0             # 冷却时间（章数）

class CrisisTrack:
    def __init__(self):
        self.obstacle_level = 5.0     # 外部压迫感
        self.base_tension = 8
        self.cooldown = 0

class RelationshipTrack:
    def __init__(self):
        # 社交拓扑网络：记录角色间的信任值 (0.0 ~ 1.0)
        self.trust_matrix = {"Hero": {"Friend_A": 0.9, "Rival_B": -0.5}}
        self.base_tension = 6
        self.cooldown = 0

class InfoAsymmetryTrack:
    def __init__(self):
        self.fog_of_war = 100.0       # 战争迷雾：未揭开的世界谜题百分比
        self.base_tension = 7
        self.cooldown = 0

class EnvBreathingTrack:
    def __init__(self):
        self.base_tension = 2         # 低张力节奏缓冲
        self.cooldown = 0

class NarrativeEngine:
    def __init__(self, target_chapters=100):
        self.current_chapter = 1
        self.target_chapters = target_chapters
        self.progress_T = 0.0         # 全局进度百分比 (0.0 ~ 1.0)
        
        # 实例化五大正交轨道
        self.tracks = {
            "momentum": CharacterMomentumTrack(),
            "crisis": CrisisTrack(),
            "relationship": RelationshipTrack(),
            "info": InfoAsymmetryTrack(),
            "environment": EnvBreathingTrack()
        }
        
        # 全局期望张力曲线（正弦波动上升）
        self.tension_target_curve = lambda t: sin(t * pi * 5) * 3 + (t * 6) + 2

    # -----------------------------------------------------------------
    # 算法核心 1：动态权重计算（基于时间之矢 T 与冷却机制）
    # -----------------------------------------------------------------
    def calculate_current_weights(self):
        t = self.progress_T
        
        # 基础权重受时间之矢控制（宏观大趋势）
        base_weights = {
            "momentum": 0.2 + 0.6 * t,              # 后期动势越来越强
            "crisis": 0.1 + 0.8 * t,                # 后期危机越来越大
            "relationship": 0.3 * (1-t) + 0.5 * t,   # 中期关系最复杂
            "info": 0.6 * (1-t) + 0.2 * t,          # 前期信息揭秘频繁
            "environment": 0.8 * (1-t)              # 越往后期，日常越少
        }
        
        # 引入CD惩罚，防止周期律死循环
        for track_name, track in self.tracks.items():
            if track.cooldown > 0:
                base_weights[track_name] *= 0.1     # 冷却中的轨道，权重降为10%
                
        return base_weights

    # -----------------------------------------------------------------
    # 算法核心 2：单章垂直切片生成器
    # -----------------------------------------------------------------
    def generate_chapter_slice(self):
        # 1. 更新全局时间之矢
        self.progress_T = self.current_chapter / self.target_chapters
        
        # 2. 计算当前状态下的轨道权重
        weights = self.calculate_current_weights()
        
        # 3. 运行加权随机算法，筛选出 1主 + 2副 轨道
        selected_tracks = weighted_random_select(weights, count=3)
        main_track = selected_tracks[0]
        sub_tracks = selected_tracks[1:]
        
        # 4. 获取目标张力
        target_tension = self.tension_target_curve(self.progress_T)
        
        # 5. 编译输出大纲（这相当于给作者的API）
        chapter_prompt = {
            "chapter": self.current_chapter,
            "target_tension": target_tension,
            "active_tracks": {
                "MAIN": main_track,
                "SUB_1": sub_tracks[0],
                "SUB_2": sub_tracks[1]
            },
            # 从全局里程碑数据库中抓取对应的数据节点
            "milestone_tasks": [
                query_milestone_db(main_track, self.progress_T),
                query_milestone_db(sub_tracks[0], self.progress_T),
                query_milestone_db(sub_tracks[1], self.progress_T)
            ]
        }
        return chapter_prompt

    # -----------------------------------------------------------------
    # 算法核心 3：状态回馈与重寻路（GPS）
    # -----------------------------------------------------------------
    def commit_writing_outcome(self, outcome):
        # outcome 为人类作者写完这一章后的实际数据反馈
        
        # 1. 处理线程间的耦合反应（副作用）
        if "info" in outcome.active_tracks and outcome.major_reveal_triggered:
            # 如果发生了重大揭秘，自动削减战争迷雾
            self.tracks["info"].fog_of_war -= 10.0
            # 耦合反应：揭秘导致主角与挚友的信任值下降
            self.tracks["relationship"].trust_matrix["Hero"]["Friend_A"] -= 0.4
            
        # 2. 更新冷却时间
        for name, track in self.tracks.items():
            if name in outcome.active_tracks:
                track.cooldown = 3 # 触发后进入3章冷却
            else:
                if track.cooldown > 0:
                    track.cooldown -= 1
                    
        # 3. 检查是否有“黑天鹅事件”（突发意外）
        if outcome.is_unexpected:
            # 启动 GPS 重寻路算法，重新对后续 5 轨里程碑节点进行重排
            self.recalculate_remaining_milestones()
            
        self.current_chapter += 1

# =====================================================================
# 辅助函数（模拟系统外部方法）
# =====================================================================
def weighted_random_select(weights, count):
    # 轮盘赌加权随机，加上少量高斯噪声，防止出来周期性规律
    return probabilistic_choice_with_noise(weights, count)

def query_milestone_db(track_name, progress):
    # 从预设的里程碑大纲库里，取出当前进度对应的具体剧情卡片
    return db.query(track_name, progress)