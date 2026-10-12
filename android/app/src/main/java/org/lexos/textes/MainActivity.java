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
 private LinearLayout[] pages;
 private Button[] tabs;
 private TextView folderLabel, pathLabel, countLabel;
 private int activeTab;
 private static final int BG = 0xff101319, PANEL = 0xff1b2029, INK = 0xfff3f4f6, MUTED = 0xffaeb7c5, ACCENT = 0xffff8a3d;

 private final Handler handler = new Handler(Looper.getMainLooper());
 private final Runnable storeDraft = () -> persistDraft(false);
 private long editRevision;
 private boolean restoring;

 private final ExecutorService io = Executors.newSingleThreadExecutor();
 @Override public void onCreate(Bundle state) {
  super.onCreate(state);
  String remembered = getPreferences(0).getString("folder", null);
  if (remembered != null) folder = Uri.parse(remembered);
  LinearLayout shell = new LinearLayout(this); shell.setOrientation(LinearLayout.VERTICAL); shell.setBackgroundColor(BG);
  shell.setPadding(dp(18),dp(12),dp(18),dp(10)); setContentView(shell);
  shell.setOnApplyWindowInsetsListener((view,insets) -> {
   int top, bottom;
   if (android.os.Build.VERSION.SDK_INT >= 30) {
    android.graphics.Insets safe = insets.getInsets(android.view.WindowInsets.Type.systemBars() | android.view.WindowInsets.Type.ime());
    top = safe.top; bottom = safe.bottom;
   } else { top = insets.getSystemWindowInsetTop(); bottom = insets.getSystemWindowInsetBottom(); }
   shell.setPadding(dp(18),top+dp(12),dp(18),bottom+dp(10)); return insets;
  });
  shell.requestApplyInsets();
  label(shell,"LEXOS",13,ACCENT);
  label(shell,"Ton espace de création",25,INK);
  label(shell,"Tes textes, à ton rythme. Même hors ligne.",14,MUTED);
  FrameLayout content = new FrameLayout(this);
  shell.addView(content,new LinearLayout.LayoutParams(-1,0,1));
  pages = new LinearLayout[3]; tabs = new Button[3];
  for (int i=0;i<3;i++) {
   ScrollView scroll = new ScrollView(this); scroll.setFillViewport(true);
   pages[i] = new LinearLayout(this); pages[i].setOrientation(LinearLayout.VERTICAL); pages[i].setPadding(0,dp(18),0,dp(18));
   scroll.addView(pages[i]); content.addView(scroll,new FrameLayout.LayoutParams(-1,-1));
  }
  label(pages[0],"Mes projets",22,INK);
  label(pages[0],"Choisis un dossier sur ton téléphone ou ta clé USB.",14,MUTED);
  folderLabel = label(pages[0],folder == null ? "Aucun dossier choisi" : "Dossier mémorisé • accès à vérifier",15,INK);
  Button choose = action(pages[0],"Choisir mon dossier",true);
  choose.setOnClickListener(v -> {
   Intent pick = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
   pick.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
   startActivityForResult(pick,1);
  });
  Button open = action(pages[0],"Ouvrir un texte",false);
  open.setOnClickListener(v -> {
   Runnable pick = () -> {
    Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
    intent.setType("*/*"); intent.addCategory(Intent.CATEGORY_OPENABLE);
    intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION); startActivityForResult(intent,2);
   };
   if (!body.getText().toString().isEmpty()) {
    new AlertDialog.Builder(this).setTitle("Ouvrir un autre texte ?")
      .setMessage("Enregistre ton texte actuel avant de le remplacer.")
      .setNegativeButton("Annuler",null).setPositiveButton("Ouvrir",(d,w) -> pick.run()).show();
   } else pick.run();
  });
  Button fresh = action(pages[0],"Nouveau projet",false);
  fresh.setOnClickListener(v -> {
   Runnable clear = () -> { project.setText(""); filename.setText("introduction"); body.setText(""); switchTab(1); project.requestFocus(); };
   if (body.length()==0) clear.run(); else new AlertDialog.Builder(this).setTitle("Commencer un projet ?")
    .setMessage("Sauvegarde le texte actuel avant de créer un nouveau brouillon.")
    .setNegativeButton("Annuler",null).setPositiveButton("Créer",(d,w) -> clear.run()).show();
  });
  label(pages[0],"Un dossier prêt à partager",19,INK);
  label(pages[0],"Chaque projet contient un README et tes textes. Les sauvegardes précédentes sont conservées.",14,MUTED);
  LinearLayout box = pages[1];
  label(box,"Écrire",22,INK);
  project = field(box,"Nom du projet","mon-projet",false);
  filename = field(box,"Nom du texte sans extension","introduction",false);
  body = field(box,"Ton texte","",true);
  project.setId(R.id.project_name); filename.setId(R.id.text_filename); body.setId(R.id.text_body);
  project.setText(getPreferences(0).getString("draft_project","mon-projet"));
  filename.setText(getPreferences(0).getString("draft_filename","introduction"));
  body.setText(getPreferences(0).getString("draft_body",""));
  pathLabel = label(box,"",13,ACCENT);
  countLabel = label(box,"",13,MUTED);
  TextWatcher watcher = new TextWatcher() {
   public void beforeTextChanged(CharSequence s,int start,int count,int after) { }
   public void onTextChanged(CharSequence s,int start,int before,int count) {
    if (!restoring) editRevision++;
    refreshMetadata();
    handler.removeCallbacks(storeDraft); handler.postDelayed(storeDraft,500);
   }
   public void afterTextChanged(Editable e) { }
  };
  project.addTextChangedListener(watcher); filename.addTextChangedListener(watcher); body.addTextChangedListener(watcher);
  save = action(box,"Enregistrer sur la clé / le téléphone",true); save.setOnClickListener(v -> saveText());
  label(box,"Ton brouillon est conservé sur ce téléphone. Enregistre dans ton dossier pour le reprendre sur PC.",13,MUTED);
  label(pages[2],"Ton assistant",22,INK);
  label(pages[2],"Écrire, reformuler et corriger",18,ACCENT);
  label(pages[2],"L’IA locale arrive dans une prochaine version Android. Tu peux déjà écrire et enregistrer tes projets sans Internet.",16,MUTED);
  Button unavailable = action(pages[2],"IA locale • bientôt disponible",false); unavailable.setEnabled(false);
  status = label(shell,folder == null ? "Choisis un dossier pour enregistrer." : "Rebranche la clé avant d’enregistrer.",13,MUTED);
  status.setAccessibilityLiveRegion(android.view.View.ACCESSIBILITY_LIVE_REGION_POLITE);
  LinearLayout nav = new LinearLayout(this); shell.addView(nav);
  String[] names = {"Projets","Écrire","IA"};
  for (int i=0;i<3;i++) {
   final int index=i; tabs[i]=new Button(this); tabs[i].setText(names[i]); tabs[i].setAllCaps(false);
   tabs[i].setMinHeight(dp(52)); nav.addView(tabs[i],new LinearLayout.LayoutParams(0,-2,1));
   tabs[i].setOnClickListener(v -> switchTab(index));
  }
  activeTab = state == null ? 0 : state.getInt("tab",0); switchTab(activeTab); refreshMetadata();
 }
 private int dp(int value) { return (int)(value*getResources().getDisplayMetrics().density); }
 private android.graphics.drawable.GradientDrawable surface(int color) {
  android.graphics.drawable.GradientDrawable shape = new android.graphics.drawable.GradientDrawable();
  shape.setColor(color); shape.setCornerRadius(dp(14)); return shape;
 }
 private TextView label(LinearLayout parent,String text,int size,int color) {
  TextView view = new TextView(this); view.setText(text); view.setTextSize(size); view.setTextColor(color);
  view.setPadding(0,dp(6),0,dp(8)); parent.addView(view); return view;
 }
 private Button action(LinearLayout parent,String text,boolean primary) {
  Button button = new Button(this); button.setText(text); button.setAllCaps(false); button.setTextSize(16);
  button.setTextColor(primary ? BG : INK); button.setBackground(surface(primary ? ACCENT : PANEL));
  button.setMinHeight(dp(54)); LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1,-2);
  params.setMargins(0,dp(8),0,dp(8)); parent.addView(button,params); return button;
 }
 private void switchTab(int selected) {
  activeTab = Math.max(0,Math.min(2,selected));
  for (int i=0;i<3;i++) {
   ((android.view.View)pages[i].getParent()).setVisibility(i==activeTab ? android.view.View.VISIBLE : android.view.View.GONE);
   tabs[i].setTextColor(i==activeTab ? BG : MUTED); tabs[i].setBackground(surface(i==activeTab ? ACCENT : PANEL));
   tabs[i].setSelected(i==activeTab);
  }
  android.view.inputmethod.InputMethodManager keyboard = (android.view.inputmethod.InputMethodManager)getSystemService(INPUT_METHOD_SERVICE);
  if (activeTab!=1 && keyboard!=null) keyboard.hideSoftInputFromWindow(body.getWindowToken(),0);
 }
 private void refreshMetadata() {
  if (pathLabel==null || countLabel==null) return;
  String p=slug(project.getText().toString()), f=slug(filename.getText().toString());
  pathLabel.setText((p.isEmpty() ? "mon-projet" : p)+"/textes/"+(f.isEmpty() ? "mon-texte" : f)+".md");
  String text=body.getText().toString().trim();
  int words=text.isEmpty() ? 0 : text.split("\\s+").length;
  countLabel.setText(words+" mots • "+body.length()+" caractères");
 }
 @Override protected void onSaveInstanceState(Bundle state) { state.putInt("tab",activeTab); super.onSaveInstanceState(state); }
 private EditText field(LinearLayout box,String name,String initial,boolean multi) {
  label(box,name,14,MUTED);
  EditText edit=new EditText(this); edit.setContentDescription(name); edit.setText(initial); edit.setSingleLine(!multi);
  edit.setTextColor(INK); edit.setHintTextColor(MUTED); edit.setTextSize(multi ? 18 : 16);
  edit.setPadding(dp(14),dp(14),dp(14),dp(14)); edit.setBackground(surface(PANEL));
  if (multi) { edit.setMinLines(9); edit.setGravity(android.view.Gravity.TOP); edit.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_FLAG_MULTI_LINE | android.text.InputType.TYPE_TEXT_FLAG_CAP_SENTENCES); }
  box.addView(edit,new LinearLayout.LayoutParams(-1,-2)); return edit;
 }
 @Override protected void onActivityResult(int request,int result,Intent data) {
  super.onActivityResult(request,result,data);
  if (result != RESULT_OK || data == null || data.getData() == null) return;
  if (request == 2) { readText(data.getData()); return; }
  if (request != 1) return;
  try {
   Uri selected = data.getData();
   int required = Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION;
   if ((data.getFlags() & required) != required) throw new SecurityException("Dossier non accessible en écriture");
   getContentResolver().takePersistableUriPermission(selected,
     Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
   folder = selected; getPreferences(0).edit().putString("folder",folder.toString()).apply(); status.setText("Dossier sélectionné."); folderLabel.setText("Dossier prêt • "+selected.getLastPathSegment()); switchTab(1);
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
     persistDraft(false); switchTab(1);
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
