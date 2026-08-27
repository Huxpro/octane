import java.lang.reflect.Method;

/** Emits Android platform wall/uptime clock pairs without reading a JS clock. */
public final class ClockPair {
  public static void main(String[] args) throws Exception {
    Method uptimeMillis = Class.forName("android.os.SystemClock").getMethod("uptimeMillis");
    int count = args.length == 0 ? 64 : Integer.parseInt(args[0]);
    for (int index = 0; index < count; index++) {
      long wallBefore = System.currentTimeMillis();
      long uptime = ((Long) uptimeMillis.invoke(null)).longValue();
      long wallAfter = System.currentTimeMillis();
      System.out.println(wallBefore + "," + uptime + "," + wallAfter);
    }
  }
}
