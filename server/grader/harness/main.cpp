// Grader harness for C++ bots. Your file must define:
//   char play(const std::vector<char>& myMoves, const std::vector<char>& opponentMoves);
#include <cctype>
#include <iostream>
#include <string>
#include <vector>

char play(const std::vector<char>& myMoves, const std::vector<char>& opponentMoves);

int main() {
    std::vector<char> mine, theirs;
    std::string line;
    std::cout << "READY" << std::endl;  // started: the grader may send the first request
    while (std::getline(std::cin, line)) {
        while (!line.empty() && (line.back() == '\r' || line.back() == ' ')) line.pop_back();
        if (line == "END") break;
        if (line.rfind("TURN ", 0) != 0 || line.size() < 8) continue;
        char me = line[5], them = line[7];
        if (me != '-') { mine.push_back(me); theirs.push_back(them); }
        char m = (char)std::toupper((unsigned char)play(mine, theirs));
        std::cout << "\nMOVE " << m << std::endl;
    }
    return 0;
}
