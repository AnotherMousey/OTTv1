import java.util.*;

// Pure chaos. Unbeatable in the long run, unwinnable too.
public class Bot {
    private final Random rng = new Random();

    public char play(List<Character> myMoves, List<Character> opponentMoves) {
        return "RPS".charAt(rng.nextInt(3));
    }
}
