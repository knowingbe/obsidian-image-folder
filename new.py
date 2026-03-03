from typing import List
import bisect


def fullBloomFlowers(flowers: List[List[int]], people: List[int]) -> List[int]:
    # Tách và sắp xếp thời gian bắt đầu và kết thúc
    # Độ phức tạp: O(N log N)
    starts = sorted([f[0] for f in flowers])
    ends = sorted([f[1] for f in flowers])

    result = []
    # Với mỗi người, dùng tìm kiếm nhị phân để tính toán
    # Độ phức tạp: O(M log N)
    for p in people:
        # Số hoa đã bắt đầu nở tính đến thời điểm p (start <= p)
        started = bisect.bisect_right(starts, p)

        # Số hoa đã tàn trước thời điểm p (end < p)
        ended = bisect.bisect_left(ends, p)

        result.append(started - ended)

    return result


# print(fullBloomFlowers([[1, 6], [3, 7], [9, 12], [4, 13]], [2, 3, 7, 11]))
from typing import List


def fullBloomFlowers(flowers: List[List[int]], people: List[int]) -> List[int]:
    # strategy là gì
    # nếu people[i] trong khoảng của flowers[i] -> +1 cho people[i]
    # if people[i] in range(r[])
    people_map = {}
    for k, v in enumerate(people):
        people_map[k] = 0
        for f in flowers:
            if v in range(f[0], f[1]+1):
                if k in people_map:
                    people_map[k] += 1
                else:
                    people_map[k] = 1
            else:
                continue
    # result = people_map.values()
    print(list(people_map.values()))

# print(fullBloomFlowers([[1,6],[3,7],[9,12],[4,13]], [2,3,7,11]))


def reversed(s:str):
    res = ""
    word = ""
    for char in s:
        if char == " ":
            res = word + " " + res
            word = ""
        else:
            word += char

    # Add the last word and remove trailing space
    res = (word + " " + res).strip()
    print(res)
print(reversed("this is a string"))