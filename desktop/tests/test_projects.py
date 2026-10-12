import unittest
import tempfile
from pathlib import Path
from lexos_textes import export_project, slug

class Projects(unittest.TestCase):
    def test_unicode_and_traversal(self):
        self.assertEqual(slug('../../Été dans l’autobus'), 'ete-dans-l-autobus')
    def test_save_versions(self):
        with tempfile.TemporaryDirectory() as folder:
            first = export_project(folder, 'Été', 'Intro', 'Bonjour été')
            second = export_project(folder, 'Été', 'Intro', 'Suite')
            self.assertEqual(first.name, 'intro.md')
            self.assertEqual(second.name, 'intro-2.md')
            self.assertEqual(first.read_text(encoding='utf-8'), 'Bonjour été')
            self.assertTrue((Path(folder)/'ete/README.md').exists())
    def test_empty_name(self):
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaises(ValueError): export_project(folder,'...','intro','Texte')
    def test_symlink_escape(self):
        with tempfile.TemporaryDirectory() as folder, tempfile.TemporaryDirectory() as outside:
            try: (Path(folder)/'projet').symlink_to(outside,target_is_directory=True)
            except OSError: self.skipTest('Liens symboliques indisponibles')
            with self.assertRaises(ValueError): export_project(folder,'projet','intro','Texte')
            self.assertEqual(list(Path(outside).iterdir()),[])

if __name__ == '__main__': unittest.main()
