package org.lexos.textes;

import java.text.Normalizer;
import java.util.Locale;

public final class ProjectNames {
 private ProjectNames() { }
 public static String slug(String value) {
  String result = Normalizer.normalize(value,Normalizer.Form.NFD)
    .replaceAll("\\p{M}","").toLowerCase(Locale.ROOT)
    .replaceAll("[^a-z0-9]+","-").replaceAll("^-|-$","");
  // Garder de la place pour l’extension et les suffixes sur les supports USB.
  if (result.length() > 80) result = result.substring(0,80).replaceAll("-$","");
  return result;
 }
}
