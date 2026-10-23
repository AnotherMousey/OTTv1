// What a C++ board bot gets (always passed to g++ with -include, so bots don't #include it).
//   std::pair<int, int> play(const State& gameState);   // returns {pid, direction}
// Coordinates are from your own side: (0, 0) is bottom-left, y = 0 is your home row, and you win
// by reaching the top-right corner. Directions: 1 up-left, 2 up, 3 up-right, 4 right,
// 5 down-right, 6 down, 7 down-left, 8 left (up = toward your goal row).
#include <string>
#include <utility>
#include <vector>

struct Piece {
    int pid;    // 1..9, the same piece keeps its number for the whole game
    char Type;  // 'R' (búa), 'P' (bao) or 'S' (kéo)
    int x, y;
};

struct State {
    std::vector<Piece> ally;      // your pieces
    std::vector<Piece> opponent;  // the enemy's pieces
    int maxTurn;                  // the game is a draw after this many moves (both sides)
    int currentTurn;              // moves already played in this game (both sides)
};
