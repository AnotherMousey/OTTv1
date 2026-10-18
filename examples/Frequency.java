import java.util.*;

// Counters the opponent's most frequent move so far.
public class Bot {
    public char play(List<Character> myMoves, List<Character> opponentMoves) {
        int r = 0, p = 0, s = 0;
        for (char c : opponentMoves) {
            if (c == 'R') r++;
            else if (c == 'P') p++;
            else if (c == 'S') s++;
        }
        if (r >= p && r >= s) return 'P';
        if (p >= s) return 'S';
        return 'R';
    }
}
