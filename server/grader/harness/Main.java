// Grader harness for Java bots. Your Bot.java must define:
//   public class Bot { public char play(List<Character> myMoves, List<Character> opponentMoves) }
import java.io.*;
import java.util.*;

public class Main {
    public static void main(String[] args) throws Exception {
        PrintStream out = new PrintStream(new FileOutputStream(FileDescriptor.out), true);
        System.setOut(System.err); // anything the bot prints goes to stderr
        BufferedReader in = new BufferedReader(new InputStreamReader(System.in));
        Bot bot = new Bot();
        out.print("READY\n"); // started: the grader may send the first request
        out.flush();
        List<Character> mine = new ArrayList<>(), theirs = new ArrayList<>();
        String line;
        while ((line = in.readLine()) != null) {
            line = line.trim();
            if (line.equals("END")) break;
            if (!line.startsWith("TURN ") || line.length() < 8) continue;
            char me = line.charAt(5), them = line.charAt(7);
            if (me != '-') { mine.add(me); theirs.add(them); }
            char m = Character.toUpperCase(bot.play(Collections.unmodifiableList(mine), Collections.unmodifiableList(theirs)));
            out.print("\nMOVE " + m + "\n");
            out.flush();
        }
        System.exit(0);
    }
}
