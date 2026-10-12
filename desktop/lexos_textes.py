"""LexOS Textes : éditeur USB et IA locale pour Linux, Windows et macOS."""
from pathlib import Path
import json
import os
import re
import tempfile
import threading
import unicodedata
import urllib.request


def slug(value):
    value = unicodedata.normalize('NFD', value)
    value = ''.join(c for c in value if not unicodedata.combining(c)).lower()
    return re.sub('[^a-z0-9]+', '-', value).strip('-')[:80].rstrip('-')


def directory(parent, name):
    path = parent / name
    if path.is_symlink():
        raise ValueError('Ce dossier est un lien symbolique. Choisis un dossier ordinaire.')
    path.mkdir(exist_ok=True)
    return path


def export_project(root, project, filename, text):
    project, filename = slug(project), slug(filename)
    if not project or not filename:
        raise ValueError('Renseigne le nom du projet et du texte.')
    root = Path(root)
    if not root.is_dir():
        raise ValueError('Le dossier choisi est inaccessible. Rebranche la clé.')
    folder = directory(root, project)
    texts = directory(folder, 'textes')
    readme = folder / 'README.md'
    try:
        with readme.open('x', encoding='utf-8') as f:
            f.write(f'# {project}\n\nLes textes sont dans le dossier `textes/`.\n')
    except FileExistsError:
        pass
    index = 1
    while True:
        name = filename + (f'-{index}' if index > 1 else '') + '.md'
        target = texts / name
        try:
            with target.open('x', encoding='utf-8', newline='\n') as f:
                try:
                    f.write(text)
                    f.flush()
                    os.fsync(f.fileno())
                except Exception:
                    target.unlink(missing_ok=True)
                    raise
            return target
        except FileExistsError:
            index += 1


def ollama_generate(model, prompt):
    # Adresse fixe locale : les textes ne sont pas envoyés à un service cloud.
    payload = json.dumps({'model': model, 'stream': False, 'prompt': prompt,
                          'system': 'Réponds en français. Aide à rédiger et corriger les textes.'}).encode()
    request = urllib.request.Request('http://127.0.0.1:11434/api/generate',
                                     data=payload, headers={'Content-Type': 'application/json'})
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(request, timeout=180) as response:
        result = json.load(response)
    text = result.get('response')
    if not isinstance(text, str) or not text.strip():
        raise ValueError('Le modèle n’a pas renvoyé de texte.')
    return text


def main():
    import tkinter as tk
    from tkinter import ttk, filedialog, messagebox
    window = tk.Tk()
    window.title('LexOS Textes — projets USB')
    window.geometry('900x740')
    window.minsize(650, 520)
    frame = ttk.Frame(window, padding=16)
    frame.pack(fill='both', expand=True)
    frame.columnconfigure(1, weight=1)
    frame.rowconfigure(5, weight=1)
    frame.rowconfigure(10, weight=1)
    state_path = Path.home() / '.lexos-textes' / 'brouillon.json'
    try:
        draft = json.loads(state_path.read_text(encoding='utf-8'))
        if not isinstance(draft, dict): draft = {}
    except (OSError, ValueError):
        draft = {}
    project = tk.StringVar(value=draft.get('project', 'mon-projet'))
    filename = tk.StringVar(value=draft.get('filename', 'introduction'))
    folder = tk.StringVar(value=draft.get('folder', ''))
    model = tk.StringVar(value=draft.get('model', 'qwen3:1.7b'))
    status = tk.StringVar(value='Écriture hors ligne. IA : Ollama doit être lancé avec un modèle déjà téléchargé.')
    ttk.Label(frame, text='LexOS Textes', font=('', 22)).grid(row=0, column=0, columnspan=3, sticky='w')
    for row, label, var in ((1,'Dossier sur la clé',folder),(2,'Nom du projet',project),(3,'Nom du texte',filename)):
        ttk.Label(frame, text=label).grid(row=row, column=0, sticky='w', pady=5)
        ttk.Entry(frame, textvariable=var).grid(row=row, column=1, sticky='ew', padx=8)
    def choose_folder():
        chosen = filedialog.askdirectory(title='Choisir le dossier USB')
        if chosen: folder.set(chosen)
    ttk.Button(frame, text='Choisir…', command=choose_folder).grid(row=1, column=2)
    text = tk.Text(frame, wrap='word', undo=True, height=12)
    text.grid(row=5, column=0, columnspan=3, sticky='nsew', pady=8)
    text.insert('1.0', draft.get('text', ''))
    ttk.Label(frame, text='Ton texte').grid(row=4, column=0, sticky='w')
    def save():
        try:
            if not folder.get(): raise ValueError('Choisis le dossier sur la clé.')
            path = export_project(folder.get(), project.get(), filename.get(), text.get('1.0', 'end-1c'))
            status.set(f'Enregistré : {path}')
        except (OSError, ValueError) as error:
            messagebox.showerror('Sauvegarde impossible', str(error))
    def open_text():
        if text.get('1.0', 'end-1c') and not messagebox.askokcancel('Ouvrir un texte', 'Sauvegarde ton texte avant de le remplacer. Continuer ?'):
            return
        selected = filedialog.askopenfilename(filetypes=[('Textes', '*.md *.txt')])
        if not selected: return
        try:
            path = Path(selected)
            with path.open('rb') as stream: raw = stream.read(2 * 1024 * 1024 + 1)
            if len(raw) > 2 * 1024 * 1024: raise ValueError('Le fichier dépasse 2 Mo.')
            content = raw.decode('utf-8-sig')
            text.delete('1.0', 'end'); text.insert('1.0', content)
            filename.set(path.stem)
            if path.parent.name == 'textes':
                project.set(path.parent.parent.name); folder.set(str(path.parent.parent.parent))
            status.set('Texte ouvert. La sauvegarde créera une nouvelle version.')
        except (OSError, ValueError) as error:
            messagebox.showerror('Ouverture impossible', str(error))
    buttons = ttk.Frame(frame)
    buttons.grid(row=6, column=0, columnspan=3, sticky='w')
    ttk.Button(buttons, text='Ouvrir un texte', command=open_text).pack(side='left', padx=4)
    ttk.Button(buttons, text='Enregistrer sur la clé', command=save).pack(side='left', padx=4)
    ttk.Label(frame, text='Modèle Ollama local').grid(row=7, column=0, sticky='w', pady=8)
    ttk.Entry(frame, textvariable=model).grid(row=7, column=1, sticky='ew')
    prompt = tk.Text(frame, wrap='word', height=3)
    prompt.grid(row=8, column=0, columnspan=3, sticky='ew')
    prompt.insert('1.0', draft.get('prompt', 'Corrige ce texte en français.'))
    result = tk.Text(frame, wrap='word', height=6, state='disabled')
    result.grid(row=10, column=0, columnspan=3, sticky='nsew', pady=8)
    messages = __import__('queue').Queue()
    def generate():
        instruction = prompt.get('1.0', 'end-1c').strip()
        chosen_model = model.get().strip()
        if not instruction or not chosen_model:
            messagebox.showerror('IA locale', 'Renseigne la demande et le modèle.'); return
        generate_button.config(state='disabled')
        status.set('Génération locale en cours…')
        request_text = instruction + '\n\nTexte actuel :\n' + text.get('1.0', 'end-1c')
        def work():
            try: messages.put(('result', ollama_generate(chosen_model, request_text)))
            except Exception: messages.put(('error', 'Ollama local inaccessible ou modèle indisponible. Vérifie Ollama et les modèles installés. Ton texte est conservé.'))
        threading.Thread(target=work, daemon=True).start()
    generate_button = ttk.Button(frame, text='Demander à l’IA locale', command=generate)
    generate_button.grid(row=9, column=0, columnspan=2, sticky='w', pady=6)
    def insert_result():
        value = result.get('1.0', 'end-1c')
        if value:
            text.insert('end', '\n\n' + value)
            status.set('Proposition ajoutée. Relis le texte avant de sauvegarder.')
    ttk.Button(frame, text='Ajouter la proposition au texte', command=insert_result).grid(row=9, column=2)
    ttk.Label(frame, textvariable=status, wraplength=820).grid(row=11, column=0, columnspan=3, sticky='w')
    def persist():
        try:
            state_path.parent.mkdir(parents=True, exist_ok=True)
            data = {'project': project.get(), 'filename': filename.get(), 'folder': folder.get(),
                    'model': model.get(), 'text': text.get('1.0', 'end-1c'), 'prompt': prompt.get('1.0', 'end-1c')}
            with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=state_path.parent, delete=False) as f:
                tmp = Path(f.name); json.dump(data, f, ensure_ascii=False)
            tmp.replace(state_path)
            return True
        except OSError:
            status.set('Impossible de conserver le brouillon local. Enregistre sur la clé avant de fermer.')
            return False
    def tick():
        try:
            kind, value = messages.get_nowait()
            generate_button.config(state='normal')
            if kind == 'result':
                result.config(state='normal'); result.delete('1.0','end'); result.insert('1.0',value); result.config(state='disabled')
                status.set('Proposition prête. Ton texte original est conservé.')
            else: status.set(value)
        except __import__('queue').Empty: pass
        window.after(150,tick)
    def autosave():
        persist(); window.after(3000,autosave)
    def close():
        if persist() or messagebox.askyesno('Brouillon non sauvegardé', 'Fermer malgré l’échec de sauvegarde du brouillon ?'):
            window.destroy()
    window.protocol('WM_DELETE_WINDOW',close)
    window.after(150,tick); window.after(3000,autosave)
    window.mainloop()

if __name__ == '__main__':
    main()
