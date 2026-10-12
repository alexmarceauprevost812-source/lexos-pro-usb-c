import org.lexos.textes.ProjectNames;
public class ProjectNamesTest {
 static void check(String input,String expected) {
  String result = ProjectNames.slug(input);
  if (!expected.equals(result)) throw new AssertionError(input + " : " + result);
 }
 public static void main(String[] args) {
  check("Essai été", "essai-ete");
  check("../../Mon Projet!", "mon-projet");
  check("INTRODUCTION", "introduction");
  check("   ", "");
  check("A".repeat(100), "a".repeat(80));
  System.out.println("5 vérifications des noms réussies.");
 }
}
