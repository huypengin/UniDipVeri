using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace UniDipVeri.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddAcademicRecord : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "academic_records",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    student_id = table.Column<Guid>(type: "uuid", nullable: false),
                    credits_completed = table.Column<int>(type: "integer", nullable: false),
                    gpa = table.Column<decimal>(type: "numeric(4,2)", nullable: false),
                    completed_courses = table.Column<string>(type: "jsonb", nullable: false),
                    source_snapshot_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    imported_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_academic_records", x => x.id);
                    table.ForeignKey(
                        name: "FK_academic_records_students_student_id",
                        column: x => x.student_id,
                        principalTable: "students",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_academic_records_student_id",
                table: "academic_records",
                column: "student_id",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "academic_records");
        }
    }
}
