package org.lexos.textes;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.provider.DocumentsContract;
import android.database.Cursor;
import android.widget.*;
import java.io.OutputStream;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import android.os.Handler;
import android.os.Looper;
import android.text.TextWatcher;
import android.text.Editable;
import android.app.AlertDialog;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends Activity {
 private Uri folder;
 private EditText project, filename, body;
 private TextView status;
 private Button save;
 private final Handler handler = new Handler(Looper.getMainLooper());
 private final Runnable storeDraft = () -> persistDraft(false);
 private long editRevision;
 private boolean restoring;

 private final ExecutorService io = Executors.newSingleThreadExecutor();
 @Override public void onCreate(Bundle state) {
  super.onCreate(state);
  String remembered = getPreferences(0).getString("folder", null);
  if (remembered != null) folder = Uri.parse(remembered);
  LinearLayout box = new LinearLayout(this); box.setOrientation(LinearLayout.VERTICAL);
  int pad = (int)(20 * getResources().getDisplayMetrics().density); box.setPadding(pad,pad,pad,pad);
  ScrollView scroll = new ScrollView(this); scroll.addView(box); setContentView(scroll);
  TextView title = new TextView(this); title.setText("LexOS Textes"); title.setTextSize(26); box.addView(title);
  TextView info = new TextView(this); info.setText("Éditeur hors ligne — l’IA n’est pas encore intégrée."); box.addView(info);
  Button choose = new Button(this); choose.setText("Choisir le dossier USB"); box.addView(choose);
  choose.setOnClickListener(v -> {
   Intent pick = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
   pick.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
   startActivityForResult(pick,1);
  });
  Button open = new Button(this); open.setText("Ouvrir un texte existant"); box.addView(open);
  open.setOnClickListener(v -> {
   Runnable pick = () -> {
    Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
    intent.setType("*/*"); intent.addCategory(Intent.CATEGORY_OPENABLE);
    intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
    startActivityForResult(intent,2);
   };
   if (!body.getText().toString().isEmpty()) {
    new AlertDialog.Builder(this).setTitle("Remplacer le texte de l’éditeur ?")
      .setMessage("Enregistre ton texte actuel sur la clé avant d’ouvrir un autre fichier.")
      .setNegativeButton("Annuler",null).setPositiveButton("Ouvrir",(d,w) -> pick.run()).show();
   } else pick.run();
  });
  project = field(box,"Nom du projet","mon-projet",false);
  filename = field(box,"Nom du texte sans extension","introduction",false);
  body = field(box,"Ton texte","",true);
  project.setId(R.id.project_name); filename.setId(R.id.text_filename); body.setId(R.id.text_body);
  project.setText(getPreferences(0).getString("draft_project","mon-projet"));
  filename.setText(getPreferences(0).getString("draft_filename","introduction"));
  body.setText(getPreferences(0).getString("draft_body",""));
  TextWatcher watcher = new TextWatcher() {
   public void beforeTextChanged(CharSequence s,int start,int count,int after) { }
   public void onTextChanged(CharSequence s,int start,int before,int count) {
    if (!restoring) editRevision++;
    handler.removeCallbacks(storeDraft); handler.postDelayed(storeDraft,500);
   }
   public void afterTextChanged(Editable e) { }
  };
  project.addTextChangedListener(watcher); filename.addTextChangedListener(watcher); body.addTextChangedListener(watcher);
  save = new Button(this); save.setText("Enregistrer le projet"); box.addView(save); save.setOnClickListener(v -> saveText());
  status = new TextView(this); status.setAccessibilityLiveRegion(android.view.View.ACCESSIBILITY_LIVE_REGION_POLITE); box.addView(status);
  status.setText(folder == null ? "Choisis un dossier." : "Dossier mémorisé : rebranche la clé pour sauvegarder.");
 }
 private EditText field(LinearLayout box,String label,String initial,boolean multi) {
  TextView heading = new TextView(this); heading.setText(label); box.addView(heading);
  EditText edit = new EditText(this); edit.setContentDescription(label); edit.setText(initial); edit.setSingleLine(!multi);
  if (multi) { edit.setMinLines(8); edit.setGravity(android.view.Gravity.TOP); edit.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_FLAG_MULTI_LINE); }
  box.addView(edit); return edit;
 }
 @Override protected void onActivityResult(int request,int result,Intent data) {
  super.onActivityResult(request,result,data);
  if (result != RESULT_OK || data == null || data.getData() == null) return;
  if (request == 2) { readText(data.getData()); return; }
  if (request != 1) return;
  try {
   Uri selected = data.getData();
   int flags = data.getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
   getContentResolver().takePersistableUriPermission(selected,flags);
   folder = selected; getPreferences(0).edit().putString("folder",folder.toString()).apply(); status.setText("Dossier sélectionné.");
  } catch (Exception e) { status.setText("Accès refusé. Choisis un autre dossier."); }
 }
 private String slug(String value) { return ProjectNames.slug(value); }
 private void persistDraft(boolean synchronous) {
  if (body == null) return;
  android.content.SharedPreferences.Editor editor = getPreferences(0).edit()
   .putString("draft_project",project.getText().toString())
   .putString("draft_filename",filename.getText().toString())
   .putString("draft_body",body.getText().toString());
  if (synchronous) editor.commit(); else editor.apply();
 }
 @Override protected void onPause() {
  handler.removeCallbacks(storeDraft); persistDraft(true); super.onPause();
 }
 private void readText(Uri uri) {
  final long revision = editRevision;
  status.setText("Lecture du fichier…");
  io.execute(() -> {
   try {
    String name = "texte";
    try (Cursor c = getContentResolver().query(uri,new String[]{android.provider.OpenableColumns.DISPLAY_NAME},null,null,null)) {
     if (c != null && c.moveToFirst() && c.getString(0) != null) name = c.getString(0);
    }
    if (!(name.toLowerCase(java.util.Locale.ROOT).endsWith(".md") || name.toLowerCase(java.util.Locale.ROOT).endsWith(".txt")))
     throw new java.io.IOException("Choisis un fichier .txt ou .md.");
    ByteArrayOutputStream bytes = new ByteArrayOutputStream();
    try (InputStream input = getContentResolver().openInputStream(uri)) {
     if (input == null) throw new java.io.IOException("Fichier inaccessible.");
     byte[] buffer = new byte[8192]; int count;
     while ((count = input.read(buffer)) != -1) {
      if (bytes.size() + count > 2 * 1024 * 1024) throw new java.io.IOException("Le texte dépasse la limite de 2 Mo.");
      bytes.write(buffer,0,count);
     }
    }
    // Refuser les octets UTF-8 invalides plutôt que déformer silencieusement le texte.
    String content = StandardCharsets.UTF_8.newDecoder()
      .decode(java.nio.ByteBuffer.wrap(bytes.toByteArray())).toString();
    final String openedName = name.substring(0,name.lastIndexOf('.'));
    runOnUiThread(() -> {
     if (isDestroyed()) return;
     if (editRevision != revision) { status.setText("Ouverture annulée : tu as modifié le brouillon pendant la lecture."); return; }
     restoring = true;
     body.setText(content.startsWith("\uFEFF") ? content.substring(1) : content);
     filename.setText(openedName); restoring = false; editRevision++;
     persistDraft(false);
     status.setText("Texte ouvert. Vérifie le nom du projet. La sauvegarde créera une nouvelle version.");
    });
   } catch (Exception e) {
    runOnUiThread(() -> {
     if (!isDestroyed()) status.setText("Ouverture impossible. Choisis un texte UTF-8 .txt ou .md de moins de 2 Mo. Le brouillon est conservé.");
    });
   }
  });
 }
 private void saveText() {
  if (folder == null) { status.setText("Choisis un dossier avant de sauvegarder."); return; }
  final String p = slug(project.getText().toString()), f = slug(filename.getText().toString()), text = body.getText().toString();
  if (p.isEmpty() || f.isEmpty()) { status.setText("Renseigne les deux noms."); return; }
  final Uri selected = folder; save.setEnabled(false); status.setText("Enregistrement…");
  io.execute(() -> {
   try {
    Uri root = DocumentsContract.buildDocumentUriUsingTree(selected,DocumentsContract.getTreeDocumentId(selected));
    Uri dir = directory(root,p), texts = directory(dir,"textes");
    if (find(dir,"README.md") == null) write(dir,"README.md","# " + p + "\n\nLes textes sont dans le dossier textes/.\n");
    String name = f + ".md"; int n = 2;
    while (find(texts,name) != null) name = f + "-" + n++ + ".md";
    write(texts,name,text);
    final String path = p + "/textes/" + name;
    runOnUiThread(() -> status.setText("Enregistré : " + path));
   } catch (Exception e) {
    runOnUiThread(() -> status.setText("Sauvegarde incomplète. Vérifie la clé, les droits et l’espace libre. Ton texte reste dans l’éditeur."));
   } finally { runOnUiThread(() -> save.setEnabled(true)); }
  });
 }
 private Uri find(Uri parent,String name) throws Exception {
  Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(parent,DocumentsContract.getDocumentId(parent));
  try (Cursor c = getContentResolver().query(children,new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID,DocumentsContract.Document.COLUMN_DISPLAY_NAME},null,null,null)) {
   if (c == null) throw new java.io.IOException("Dossier inaccessible");
   while (c.moveToNext()) if (name.equals(c.getString(1))) return DocumentsContract.buildDocumentUriUsingTree(parent,c.getString(0));
  }
  return null;
 }
 private Uri directory(Uri parent,String name) throws Exception {
  Uri existing = find(parent,name);
  if (existing != null) {
   try (Cursor c = getContentResolver().query(existing,new String[]{DocumentsContract.Document.COLUMN_MIME_TYPE},null,null,null)) {
    if (c == null || !c.moveToFirst() || !DocumentsContract.Document.MIME_TYPE_DIR.equals(c.getString(0))) throw new java.io.IOException("Le nom existe comme fichier");
   }
   return existing;
  }
  Uri created = DocumentsContract.createDocument(getContentResolver(),parent,DocumentsContract.Document.MIME_TYPE_DIR,name);
  if (created == null) throw new java.io.IOException("Création impossible"); return created;
 }
 private void write(Uri parent,String name,String content) throws Exception {
  Uri doc = DocumentsContract.createDocument(getContentResolver(),parent,"text/markdown",name);
  if (doc == null) throw new java.io.IOException("Création impossible");
  try (OutputStream out = getContentResolver().openOutputStream(doc,"w")) {
   if (out == null) throw new java.io.IOException("Écriture impossible"); out.write(content.getBytes(StandardCharsets.UTF_8));
  } catch (Exception error) {
   try { DocumentsContract.deleteDocument(getContentResolver(),doc); } catch (Exception ignored) { }
   throw error;
  }
 }
 @Override protected void onDestroy() { handler.removeCallbacks(storeDraft); io.shutdown(); super.onDestroy(); }
}
