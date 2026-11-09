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

// "<k> <x y> * k"
static bool readWalls(std::istringstream& in, std::vector<Cell>& out) {
    int k = 0;
    if (!(in >> k)) return false;
    for (int i = 0; i < k; i++) {
        Cell c;
        if (!(in >> c.x >> c.y)) return false;
        out.push_back(c);
    }
    return true;
}

int main() {
    std::string line;
    std::cout << "READY" << std::endl;  // started: the grader may send the first request
    while (std::getline(std::cin, line)) {
        while (!line.empty() && (line.back() == '\r' || line.back() == ' ')) line.pop_back();
        if (line == "END") break;
        if (line.rfind("STATE ", 0) != 0) continue;
        // "STATE <currentTurn> <maxTurn> <ally pieces> <opponent pieces> <walls> <width> <height>
        //  <goalMode> <my goals> <enemy goals>"
        std::istringstream in(line.substr(6));
        State s;
        if (!(in >> s.currentTurn >> s.maxTurn) || !readPieces(in, s.ally) || !readPieces(in, s.opponent) || !readWalls(in, s.walls)) continue;
        if (!(in >> s.width >> s.height)) s.width = s.height = 9;
        if (!(in >> s.goalMode) || !readWalls(in, s.goals) || !readWalls(in, s.enemyGoals)) {  // the standard corners
            s.goalMode = 0;
            s.goals = {Cell{s.width, s.height}};
            s.enemyGoals = {Cell{1, 1}};
        }
        std::pair<int, int> m = play(s);
        std::cout << "\nMOVE " << m.first << ' ' << m.second << std::endl;
    }
    return 0;
}
