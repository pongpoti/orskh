-- The vascular specialty code is VASCULAR, as the hospital writes it (it was stored as VAS). Safe to run again.
UPDATE surgeons SET specialty = 'VASCULAR', updated_at = now() WHERE specialty = 'VAS';
UPDATE staff_registrations SET specialty = 'VASCULAR' WHERE specialty = 'VAS';
