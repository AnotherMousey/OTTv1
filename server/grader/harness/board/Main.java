// Grader harness for Java board bots. Your Bot.java must define:
//   public class Bot { public int[] play(State gameState) }   // returns {pid, direction}
// Coordinates are 1-9, from your own side: (1, 1) is bottom-left, y = 1 is your home row, and you win
// by reaching the top-right corner. Directions: 1 up-left, 2 up, 3 up-right, 4 right,
// 5 down-right, 6 down, 7 down-left, 8 left (up = toward your goal row).
import java.io.*;
import java.util.*;

class Piece {
    public int pid;    // 1..9, the same piece keeps its number for the whole game
    public char Type;  // 'R' (búa), 'P' (bao) or 'S' (kéo)
    public int x, y;
}

class State {
    public List<Piece> ally = new ArrayList<>();      // your pieces
    public List<Piece> opponent = new ArrayList<>();  // the enemy's pieces
    public int maxTurn;                               // a draw after this many moves (both sides)
    public int currentTurn;                           // moves already played (both sides)
}

public class Main {
    // "<n> <pid type x y> * n" starting at p[at]; returns the index after it
    static int readPieces(String[] p, int at, List<Piece> out) {
        int n = Integer.parseInt(p[at++]);
        for (int i = 0; i < n; i++) {
            Piece q = new Piece();
            q.pid = Integer.parseInt(p[at]);
            q.Type = p[at + 1].charAt(0);
            q.x = Integer.parseInt(p[at + 2]);
            q.y = Integer.parseInt(p[at + 3]);
            out.add(q);
            at += 4;
        }
        return at;
    }

    public static void main(String[] args) throws Exception {
        PrintStream out = new PrintStream(new FileOutputStream(FileDescriptor.out), true);
        System.setOut(System.err); // anything the bot prints goes to stderr
        BufferedReader in = new BufferedReader(new InputStreamReader(System.in));
        Bot bot = new Bot();
        out.print("READY\n"); // started: the grader may send the first request
        out.flush();
        String line;
        while ((line = in.readLine()) != null) {
            line = line.trim();
            if (line.equals("END")) break;
            if (!line.startsWith("STATE ")) continue;
            // "STATE <currentTurn> <maxTurn> <ally pieces> <opponent pieces>"
            String[] p = line.split("\s+");
            State s = new State();
            s.currentTurn = Integer.parseInt(p[1]);
            s.maxTurn = Integer.parseInt(p[2]);
            readPieces(p, readPieces(p, 3, s.ally), s.opponent);
            int[] m = bot.play(s);
            String reply = m == null || m.length != 2 ? "X" : m[0] + " " + m[1];
            out.print("\nMOVE " + reply + "\n");
            out.flush();
        }
        System.exit(0);
    }
}
