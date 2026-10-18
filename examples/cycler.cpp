#include <vector>
using namespace std;

// Rock, paper, scissors, rock, paper, scissors...
char play(const vector<char>& myMoves, const vector<char>& opponentMoves) {
    return "RPS"[myMoves.size() % 3];
}
