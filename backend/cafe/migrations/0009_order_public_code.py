from django.db import migrations, models

from cafe import codes


def delete_unpaid_and_fill_codes(apps, schema_editor):
    """Orders that are not paid can only be left from before payment came first (S28), and
    nobody can look them up: delete them. Every paid order gets its own random code."""
    Order = apps.get_model("cafe", "Order")
    Order.objects.exclude(payment_status="paid").delete()
    used = set()
    for order in Order.objects.all():
        code = codes.generate()
        while code in used:
            code = codes.generate()
        used.add(code)
        order.public_code = code
        order.save(update_fields=["public_code"])
    if schema_editor.connection.vendor == "postgresql":
        # The delete leaves deferred foreign key checks pending, and Postgres refuses the
        # ALTER TABLE below until they have run.
        schema_editor.execute("SET CONSTRAINTS ALL IMMEDIATE")


class Migration(migrations.Migration):

    dependencies = [
        ("cafe", "0008_staff_groups"),
    ]

    operations = [
        # Added empty first, so rows that exist can be given different codes before the
        # column is made unique.
        migrations.AddField(
            model_name="order",
            name="public_code",
            field=models.CharField(editable=False, max_length=12, null=True),
        ),
        migrations.RunPython(delete_unpaid_and_fill_codes, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="order",
            name="public_code",
            field=models.CharField(
                default=codes.generate, editable=False, max_length=12, unique=True
            ),
        ),
    ]
