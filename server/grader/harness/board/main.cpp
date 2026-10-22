// Grader harness for C++ board bots. Your file must define:
//   Move play(const std::vector<std::string>& board, int turn, int maxTurns);
// (Move and the board layout are described in api.hpp.)
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

Move play(const std::vector<std::string>& board, int turn, int maxTurns);

int main() {
    std::string line;
    while (std::getline(std::cin, line)) {
        while (!line.empty() && (line.back() == '\r' || line.back() == ' ')) line.pop_back();
        if (line == "END") break;
        if (line.rfind("TURN ", 0) != 0) continue;
        std::istringstream in(line.substr(5));
        int turn = 0, maxTurns = 0, w = 0, h = 0;
        std::string cells;
        if (!(in >> turn >> maxTurns >> w >> h >> cells) || (int)cells.size() != w * h) continue;
        std::vector<std::string> board;
        for (int y = 0; y < h; y++) board.push_back(cells.substr(y * w, w));
        Move m = play(board, turn, maxTurns);
        std::cout << "\nMOVE " << m.fromX << ' ' << m.fromY << ' ' << m.toX << ' ' << m.toY << std::endl;
    }
    return 0;
}
