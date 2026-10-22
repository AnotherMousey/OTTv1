// Grader harness for Java board bots. Your Bot.java must define:
//   public class Bot { public int[] play(char[][] board, int turn, int maxTurns) }
// board[y][x]: 'R' 'P' 'S' = your pieces, 'r' 'p' 's' = enemy pieces, '.' = empty.
// Return {fromX, fromY, toX, toY}.
import java.io.*;
import java.util.*;

public class Main {
    public static void main(String[] args) throws Exception {
        PrintStream out = new PrintStream(new FileOutputStream(FileDescriptor.out), true);
        System.setOut(System.err); // anything the bot prints goes to stderr
        BufferedReader in = new BufferedReader(new InputStreamReader(System.in));
        Bot bot = new Bot();
        String line;
        while ((line = in.readLine()) != null) {
            line = line.trim();
            if (line.equals("END")) break;
            if (!line.startsWith("TURN ")) continue;
            String[] p = line.split("\\s+");
            if (p.length < 6) continue;
            int turn = Integer.parseInt(p[1]), maxTurns = Integer.parseInt(p[2]);
            int w = Integer.parseInt(p[3]), h = Integer.parseInt(p[4]);
            String cells = p[5];
            if (cells.length() != w * h) continue;
            char[][] board = new char[h][];
            for (int y = 0; y < h; y++) board[y] = cells.substring(y * w, (y + 1) * w).toCharArray();
            int[] m = bot.play(board, turn, maxTurns);
            String reply = m == null || m.length != 4 ? "X" : m[0] + " " + m[1] + " " + m[2] + " " + m[3];
            out.print("\nMOVE " + reply + "\n");
            out.flush();
        }
        System.exit(0);
    }
}
