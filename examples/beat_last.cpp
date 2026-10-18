#include <vector>
#include <cstdlib>
using namespace std;

// Throws whatever beats the opponent's previous move.
char play(const vector<char>& myMoves, const vector<char>& opponentMoves) {
    if (opponentMoves.empty()) return "RPS"[rand() % 3];
    switch (opponentMoves.back()) {
        case 'R': return 'P';
        case 'P': return 'S';
        case 'S': return 'R';
        default:  return 'R';
    }
}
