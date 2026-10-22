// What a C++ board bot gets (always passed to g++ with -include, so bots don't #include it).
//   Move play(const std::vector<std::string>& board, int turn, int maxTurns);
// board[y][x]: 'R' 'P' 'S' = your pieces, 'r' 'p' 's' = enemy pieces, '.' = empty.
// y = 0 is your home row; you start bottom-left and win by reaching the top-right corner.
#include <string>
#include <vector>

struct Move {
    int fromX, fromY, toX, toY;
};
