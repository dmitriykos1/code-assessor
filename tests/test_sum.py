from sum import sum


def test_sum_positive():
    """Test sum with positive numbers"""
    assert sum(1, 2) == 3
    assert sum(100, 200) == 300


def test_sum_negative():
    """Test sum with negative numbers"""
    assert sum(-1, -2) == -3
    assert sum(-100, 100) == 0


def test_sum_zero():
    """Test sum with zero values"""
    assert sum(0, 0) == 0
    assert sum(5, 0) == 5
