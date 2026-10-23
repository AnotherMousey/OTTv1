// Grader harness for C++ board bots. Your file must define:
//   std::pair<int, int> play(const State& gameState);
// (Piece and State are described in api.hpp.)
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

std::pair<int, int> play(const State& gameState);

// "<n> <pid type x y> * n"
static bool readPieces(std::istringstream& in, std::vector<Piece>& out) {
    int n = 0;
    if (!(in >> n)) return false;
    for (int i = 0; i < n; i++) {
        Piece p;
        if (!(in >> p.pid >> p.Type >> p.x >> p.y)) return false;
        out.push_back(p);
    }
    return true;
}

int main() {
    std::string line;
    while (std::getline(std::cin, line)) {
        while (!line.empty() && (line.back() == '\r' || line.back() == ' ')) line.pop_back();
        if (line == "END") break;
        if (line.rfind("STATE ", 0) != 0) continue;
        // "STATE <currentTurn> <maxTurn> <ally pieces> <opponent pieces>"
        std::istringstream in(line.substr(6));
        State s;
        if (!(in >> s.currentTurn >> s.maxTurn) || !readPieces(in, s.ally) || !readPieces(in, s.opponent)) continue;
        std::pair<int, int> m = play(s);
        std::cout << "\nMOVE " << m.first << ' ' << m.second << std::endl;
    }
    return 0;
}
