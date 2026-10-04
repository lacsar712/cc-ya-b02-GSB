"""电场采样：模拟场站大气电场仪。

读数只能由服务端采集（worker 周期采集，或报送判定前兜底补采），
前端不得自填采样值做演示；演示越界应通过调低电场上限实现。
"""

import random

MIN_KV_M = 0.5
MAX_KV_M = 9.5


def sample_field_kv_m() -> float:
    """采集一次电场强度读数（kV/m），落在 0.5~9.5 之间。

    把电场上限调到 0.5 以下即可稳定模拟「读数越界」。
    """
    return round(random.uniform(MIN_KV_M, MAX_KV_M), 2)
